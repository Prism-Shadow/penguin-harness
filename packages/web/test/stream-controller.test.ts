/**
 * stream-controller.ts unit tests: buffer/replay phase machine, task_state as the
 * authoritative state while streaming (history-closing decision), the generation guard
 * against rebuild re-entrancy during replay, resync rebuild (clears the pending table +
 * keeps localDecisions), approval re-delivery keyed by origin composite key + missing
 * card backfill, and history load failure/retry.
 */
import { describe, expect, it } from "vitest";
import {
  approvalDecision,
  assistantText,
  partialText,
  partialToolCallOutput,
  tokenUsage,
  toolCall,
  userText,
  withOrigin,
} from "@prismshadow/penguin-core/omnimessage";
import type { OmniMessage, TokenCounts } from "@prismshadow/penguin-core/omnimessage";
import type {
  MessagesLiveTail,
  MessagesPageInfo,
  PendingFollowUpInfo,
  PendingSteeringInfo,
  ServerEvent,
  SessionStatus,
} from "@prismshadow/penguin-server/api";
import {
  MAX_LOADED_MESSAGES,
  WINDOW_MESSAGES,
  createStreamController,
} from "../src/lib/omni/stream-controller";
import type { MessagesPageQuery, StreamController } from "../src/lib/omni/stream-controller";
import { approvalKey, findToolCard } from "../src/lib/omni/stream-model";
import type { AssistantTextItem, TaskStatsItem, ToolCallItem } from "../src/lib/omni/stream-model";

/** Override a message timestamp (constructor defaults to the current time). */
function at<M extends OmniMessage>(msg: M, ts: string): M {
  return { ...msg, timestamp: ts };
}

function counts(total: number): TokenCounts {
  return { cache_read: 0, cache_write: 0, output: 0, total };
}

/** Flush microtasks/macrotasks: let async loads started inside rebuild finish. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

interface Harness {
  controller: StreamController;
  states: SessionStatus[];
  pendingSteering: PendingSteeringInfo[][];
  pendingFollowUps: PendingFollowUpInfo[][];
  errors: Array<string | null>;
  loadings: boolean[];
  loadCalls: () => number;
  /** The `page` argument of each loadMessages call, in order (undefined = the legacy full read). */
  pageArgs: Array<MessagesPageQuery | undefined>;
  resolveLoad: (
    messages: OmniMessage[],
    live?: MessagesLiveTail,
    serverNowMs?: number | null,
    page?: MessagesPageInfo,
  ) => void;
  rejectLoad: (err: Error) => void;
}

function createHarness(): Harness {
  const pendingLoads: Array<{
    resolve: (m: {
      messages: OmniMessage[];
      live?: MessagesLiveTail;
      serverNowMs?: number | null;
      page?: MessagesPageInfo;
    }) => void;
    reject: (e: unknown) => void;
  }> = [];
  const states: SessionStatus[] = [];
  const pendingSteering: PendingSteeringInfo[][] = [];
  const pendingFollowUps: PendingFollowUpInfo[][] = [];
  const errors: Array<string | null> = [];
  const loadings: boolean[] = [];
  const pageArgs: Array<MessagesPageQuery | undefined> = [];
  let calls = 0;
  const controller = createStreamController({
    loadMessages: (page) =>
      new Promise<{
        messages: OmniMessage[];
        live?: MessagesLiveTail;
        serverNowMs?: number | null;
        page?: MessagesPageInfo;
      }>((resolve, reject) => {
        calls += 1;
        pageArgs.push(page);
        pendingLoads.push({ resolve, reject });
      }),
    onTaskState: (s) => states.push(s),
    onPendingSteering: (items) => pendingSteering.push(items),
    onPendingFollowUps: (items) => pendingFollowUps.push(items),
    onLoading: (l) => loadings.push(l),
    onError: (e) => errors.push(e),
    onModelChange: () => {},
    onPendingChange: () => {},
    now: () => 1_000_000,
  });
  return {
    controller,
    states,
    pendingSteering,
    pendingFollowUps,
    errors,
    loadings,
    loadCalls: () => calls,
    pageArgs,
    resolveLoad: (messages, live, serverNowMs, page) =>
      pendingLoads.shift()!.resolve({
        messages,
        ...(live !== undefined ? { live } : {}),
        ...(serverNowMs !== undefined ? { serverNowMs } : {}),
        ...(page !== undefined ? { page } : {}),
      }),
    rejectLoad: (err) => pendingLoads.shift()!.reject(err),
  };
}

/** Shorthand for a page envelope (zeroed priors unless overridden). */
function pageInfo(over: Partial<MessagesPageInfo> = {}): MessagesPageInfo {
  return {
    earlierTurns: 0,
    prior: { subagentTokens: 0, elapsedMs: 0, sessionTokens: 0, contextTokens: 0 },
    ...over,
  };
}

const HISTORY_TASK: OmniMessage[] = [
  at(userText("question"), "2026-07-05T00:00:00.000Z"),
  at(assistantText("answer"), "2026-07-05T00:00:03.000Z"),
  at(tokenUsage(counts(1000), counts(1000)), "2026-07-05T00:00:05.000Z"),
];

describe("the running Task's live anchor is back-dated from the server's clock at read time", () => {
  it("counts an event still in flight, which the Trace's own span cannot see", async () => {
    const h = createHarness();
    const p = h.controller.load();
    // Still running, so the Task stays open. Its last Trace entry is 5s in, but the server's
    // clock says 300s have passed — a tool has been executing throughout, appending nothing.
    h.controller.handleServer({ type: "task_state", state: "running" });
    h.resolveLoad(HISTORY_TASK, undefined, Date.parse("2026-07-05T00:05:00.000Z"));
    await p;
    expect(h.controller.model.taskOpen).toBe(true);
    // The harness's local clock is 1_000_000, nothing like the server's: the anchor is
    // back-dated by the full 300s the server reports, not by the 5s the Trace shows.
    expect(1_000_000 - h.controller.model.taskStartLocalMs).toBe(300_000);
  });

  it("falls back to the Trace's span when no Date header came back", async () => {
    const h = createHarness();
    const p = h.controller.load();
    h.controller.handleServer({ type: "task_state", state: "running" });
    h.resolveLoad(HISTORY_TASK, undefined, null);
    await p;
    expect(1_000_000 - h.controller.model.taskStartLocalMs).toBe(5_000);
  });
});

describe("in-stream task_state is the authoritative running state (history-closing decision)", () => {
  it("subscription snapshot idle: history closes, producing the last Task's stats row", async () => {
    const h = createHarness();
    const p = h.controller.load();
    // Connection comes first: the snapshot arrives before history, so it's buffered.
    h.controller.handleServer({ type: "task_state", state: "idle" });
    h.resolveLoad(HISTORY_TASK);
    await p;
    expect(h.states).toContain("idle");
    expect(h.controller.model.items.map((i) => i.kind)).toEqual([
      "user_text",
      "assistant_text",
      "task_stats",
    ]);
  });

  it("subscription snapshot running: no early close; only the later idle event closes", async () => {
    const h = createHarness();
    const p = h.controller.load();
    h.controller.handleServer({ type: "task_state", state: "running" });
    h.resolveLoad(HISTORY_TASK);
    await p;
    expect(h.controller.model.items.some((i) => i.kind === "task_stats")).toBe(false);
    // The real flip event arrives (live phase) → closes out.
    h.controller.handleServer({ type: "task_state", state: "idle" });
    expect(h.controller.model.items.some((i) => i.kind === "task_stats")).toBe(true);
  });

  it("no close on the list snapshot while the stream snapshot is missing; a late idle snapshot completes the same close", async () => {
    const h = createHarness();
    const p = h.controller.load();
    h.resolveLoad(HISTORY_TASK);
    await p;
    // No in-stream state at all → doesn't close out (list snapshot isn't trusted).
    expect(h.controller.model.items.some((i) => i.kind === "task_stats")).toBe(false);
    h.controller.handleServer({ type: "task_state", state: "idle" });
    expect(h.controller.model.items.some((i) => i.kind === "task_stats")).toBe(true);
  });

  it("task_state during buffering reports to the input area immediately (without waiting for history replay)", async () => {
    const h = createHarness();
    void h.controller.load();
    h.controller.handleServer({ type: "task_state", state: "running" });
    // History hasn't returned yet, but state is already reported.
    expect(h.states).toEqual(["running"]);
  });

  it("reports the pending-steering mirror from task_state, and its absence as empty", async () => {
    const h = createHarness();
    void h.controller.load();
    h.controller.handleServer({
      type: "task_state",
      state: "running",
      pendingSteering: [{ id: "st-1", text: "hold on", images: 0, files: 1 }],
    });
    // A later event without the field means "none left" — reported as empty, not skipped.
    h.controller.handleServer({ type: "task_state", state: "running" });
    expect(h.pendingSteering).toEqual([[{ id: "st-1", text: "hold on", images: 0, files: 1 }], []]);
  });

  it("reports the queued follow-up list from task_state, and its absence as empty", async () => {
    const h = createHarness();
    void h.controller.load();
    h.controller.handleServer({
      type: "task_state",
      state: "running",
      queued: 1,
      pendingFollowUps: [{ id: "fu-1", text: "next up", images: 1, files: 0 }],
    });
    h.controller.handleServer({ type: "task_state", state: "running" });
    expect(h.pendingFollowUps).toEqual([
      [{ id: "fu-1", text: "next up", images: 1, files: 0 }],
      [],
    ]);
  });

  it("closes the current Task before an auto-started queued follow-up begins", async () => {
    const h = createHarness();
    const p = h.controller.load();
    h.controller.handleServer({ type: "task_state", state: "running", queued: 1 });
    h.resolveLoad(HISTORY_TASK);
    await p;

    // Server ordering for a queued follow-up: current run flips idle, then launchTask publishes
    // the queued user input before its running state. The first idle must seal Task 1 before that.
    h.controller.handleServer({ type: "task_state", state: "idle", queued: 1 });
    h.controller.handleOmni(at(userText("follow-up"), "2026-07-05T00:01:00.000Z"));
    h.controller.handleServer({ type: "task_state", state: "running", queued: 0 });
    h.controller.handleOmni(at(assistantText("follow-up answer"), "2026-07-05T00:01:03.000Z"));
    h.controller.handleOmni(at(tokenUsage(counts(1400), counts(400)), "2026-07-05T00:01:05.000Z"));
    h.controller.handleServer({ type: "task_state", state: "idle", queued: 0 });

    const stats = h.controller.model.items.filter(
      (item) => item.kind === "task_stats",
    ) as TaskStatsItem[];
    expect(stats.map((item) => item.assistantText)).toEqual(["answer", "follow-up answer"]);
  });
});

describe("approval re-delivery (origin composite key + missing-card backfill)", () => {
  it("child-session approval re-delivery: builds the nested card from toolCall when none is found; repeated re-delivery builds no duplicate", async () => {
    const h = createHarness();
    const p = h.controller.load();
    h.resolveLoad([]);
    await p;
    const tc = withOrigin(
      toolCall({ name: "exec_command", arguments: '{"cmd":"rm -rf x"}', toolCallId: "t1" }),
      "c1",
    );
    const ev: ServerEvent = { type: "approval_request", toolCall: tc, origin: ["c1"] };
    h.controller.handleServer(ev);
    // The pending table is keyed by origin composite key.
    expect(h.controller.pendingApprovals.has(approvalKey(["c1"], "t1"))).toBe(true);
    expect(h.controller.pendingApprovals.has(approvalKey(undefined, "t1"))).toBe(false);
    // The nested card is backfilled (child-session messages aren't in the parent Trace;
    // without this mechanism, the approval button has nowhere to render).
    const card = findToolCard(h.controller.model, ["c1"], "t1");
    expect(card).not.toBeNull();
    expect((card as ToolCallItem).name).toBe("exec_command");
    // Repeated re-delivery (reconnect) doesn't create a duplicate card.
    h.controller.handleServer(ev);
    const sub = h.controller.model.subagents.get("c1")!;
    expect(sub.items.filter((i) => i.kind === "tool_call")).toHaveLength(1);
  });

  it("main-session approval re-delivery: no duplicate card when history already has one", async () => {
    const h = createHarness();
    const p = h.controller.load();
    const tc = toolCall({ name: "write_file", arguments: "{}", toolCallId: "t2" });
    h.resolveLoad([at(tc, "2026-07-05T00:00:00.000Z")]);
    await p;
    h.controller.handleServer({ type: "approval_request", toolCall: tc });
    expect(h.controller.model.items.filter((i) => i.kind === "tool_call")).toHaveLength(1);
    expect(h.controller.pendingApprovals.has(approvalKey(undefined, "t2"))).toBe(true);
  });

  it("approval_decision events remove the matching pending entry by origin composite key", async () => {
    const h = createHarness();
    const p = h.controller.load();
    h.resolveLoad([]);
    await p;
    const tc = withOrigin(toolCall({ name: "x", arguments: "{}", toolCallId: "t1" }), "c1");
    h.controller.handleServer({ type: "approval_request", toolCall: tc, origin: ["c1"] });
    expect(h.controller.pendingApprovals.size).toBe(1);
    h.controller.handleOmni(withOrigin(approvalDecision("allow", "t1"), "c1"));
    expect(h.controller.pendingApprovals.size).toBe(0);
  });
});

describe("resync rebuild", () => {
  it("rebuild clears the pending-approval table; still-pending requests the server re-delivers afterwards rebuild naturally (#28)", async () => {
    const h = createHarness();
    const p = h.controller.load();
    h.resolveLoad([]);
    await p;
    const tc = toolCall({ name: "x", arguments: "{}", toolCallId: "t1" });
    h.controller.handleServer({ type: "approval_request", toolCall: tc });
    expect(h.controller.pendingApprovals.size).toBe(1);

    h.controller.handleServer({ type: "resync_required" });
    // Approvals already decided during the disconnect leave no residual button.
    expect(h.controller.pendingApprovals.size).toBe(0);
    // The server re-delivers the still-pending request on the same connection
    // (buffered during rebuild, rebuilt after replay).
    h.controller.handleServer({ type: "approval_request", toolCall: tc });
    h.resolveLoad([at(tc, "2026-07-05T00:00:00.000Z")]);
    await flush();
    expect(h.controller.pendingApprovals.size).toBe(1);
  });

  it("rebuild keeps localDecisions: approvals clicked locally still show as manual after replay (#22)", async () => {
    const h = createHarness();
    const p = h.controller.load();
    const tc = at(
      toolCall({ name: "x", arguments: "{}", toolCallId: "t1" }),
      "2026-07-05T00:00:00.000Z",
    );
    h.resolveLoad([tc]);
    await p;
    h.controller.markLocalDecision("t1");

    h.controller.handleServer({ type: "resync_required" });
    h.resolveLoad([tc, at(approvalDecision("allow", "t1"), "2026-07-05T00:00:01.000Z")]);
    await flush();
    const card = h.controller.model.items.find((i) => i.kind === "tool_call") as ToolCallItem;
    expect(card.decision).toBe("allow");
    expect(card.decisionSource).toBe("manual");
  });

  it("resync during replay: the current round is voided and the remaining buffer moves to the new round, with no reordering or duplication (#21/#26)", async () => {
    const h = createHarness();
    const p = h.controller.load();
    // Buffer: old event A → resync_required → task_state:idle (server re-delivery order).
    h.controller.handleOmni(at(assistantText("old event A"), "2026-07-05T00:00:01.000Z"));
    h.controller.handleServer({ type: "resync_required" });
    h.controller.handleServer({ type: "task_state", state: "idle" });
    // First round of history returns: replaying up to resync_required invalidates this round.
    h.resolveLoad([at(userText("question"), "2026-07-05T00:00:00.000Z")]);
    await p;
    expect(h.loadCalls()).toBe(2);
    // The old replay must not reset phase back to live: events arriving during rebuild are still
    // buffered, not fed to a model. And with the atomic swap the OLD transcript stays visible until
    // the rebuild's history load returns — mid-rebuild the model still shows the pre-resync content
    // (the question + "old event A"), never a blank, and the live event is not yet in it (feeding it
    // here as a third item would fail this assertion).
    const live = at(assistantText("output during rebuild"), "2026-07-05T00:00:02.000Z");
    h.controller.handleOmni(live);
    expect(h.controller.model.items.map((i) => i.kind)).toEqual(["user_text", "assistant_text"]);
    // Second round of history (authoritative) returns: the transferred task_state and
    // buffered events replay in order.
    h.resolveLoad([
      at(userText("question"), "2026-07-05T00:00:00.000Z"),
      at(tokenUsage(counts(500), counts(500)), "2026-07-05T00:00:01.500Z"),
    ]);
    await flush();
    expect(h.controller.model.items.map((i) => i.kind)).toEqual([
      "user_text",
      "task_stats",
      "assistant_text",
    ]);
    expect(h.controller.model.items.filter((i) => i.kind === "user_text")).toHaveLength(1);
  });
});

describe("live-tail seeding (reload mid-stream)", () => {
  it("drops buffered partials at/before the cursor and seeds fragments; later partials continue on top", async () => {
    const h = createHarness();
    const p = h.controller.load();
    h.controller.handleServer({ type: "task_state", state: "running" }, "e1-3");
    // Already covered by the fragment snapshot (seq <= cursor): must be dropped, or the
    // seeded prefix would double.
    h.controller.handleOmni(partialText("start", "Hel"), "e1-4");
    h.controller.handleOmni(partialText("delta", "lo"), "e1-5");
    // After the cursor: continues the seeded fragment.
    h.controller.handleOmni(partialText("delta", " world"), "e1-6");
    h.resolveLoad([at(userText("question"), "2026-07-05T00:00:00.000Z")], {
      cursor: "e1-5",
      fragments: [at(partialText("start", "Hello"), "2026-07-05T00:00:01.000Z")],
    });
    await p;
    const texts = h.controller.model.items.filter((i) => i.kind === "assistant_text");
    expect(texts).toHaveLength(1);
    expect((texts[0] as AssistantTextItem).text).toBe("Hello world");
    expect((texts[0] as AssistantTextItem).streaming).toBe(true);
  });

  it("tool-output fragment seeds onto the history-built card and keeps streaming", async () => {
    const h = createHarness();
    const p = h.controller.load();
    h.controller.handleServer({ type: "task_state", state: "running" }, "e1-7");
    h.controller.handleOmni(
      partialToolCallOutput({ eventType: "delta", output: "line 2\n", toolCallId: "t1" }),
      "e1-9",
    );
    h.resolveLoad(
      [
        at(userText("run it"), "2026-07-05T00:00:00.000Z"),
        at(
          toolCall({ name: "exec_command", arguments: '{"cmd":"x"}', toolCallId: "t1" }),
          "2026-07-05T00:00:01.000Z",
        ),
      ],
      {
        cursor: "e1-8",
        fragments: [
          at(
            partialToolCallOutput({ eventType: "start", output: "line 1\n", toolCallId: "t1" }),
            "2026-07-05T00:00:02.000Z",
          ),
        ],
      },
    );
    await p;
    const cards = h.controller.model.items.filter((i) => i.kind === "tool_call");
    expect(cards).toHaveLength(1);
    const card = cards[0] as ToolCallItem;
    expect(card.output).toBe("line 1\nline 2\n");
    expect(card.outputStreaming).toBe(true);
    expect(card.outputComplete).toBe(false);
  });

  it("epoch mismatch: neither drops nor seeds (buffered partials replay as-is)", async () => {
    const h = createHarness();
    const p = h.controller.load();
    h.controller.handleOmni(partialText("start", "He"), "old-4");
    h.controller.handleOmni(partialText("delta", "llo"), "old-5");
    h.resolveLoad([], {
      cursor: "new-9",
      fragments: [partialText("start", "Hello")],
    });
    await p;
    // The buffered start+delta applied normally; the fragment was NOT seeded (a seed on
    // top of the applied start would produce a second item).
    const texts = h.controller.model.items.filter((i) => i.kind === "assistant_text");
    expect(texts).toHaveLength(1);
    expect((texts[0] as AssistantTextItem).text).toBe("Hello");
  });

  it("complete messages at/before the cursor are never cursor-dropped: overlap dedup decides", async () => {
    const h = createHarness();
    const p = h.controller.load();
    const inHistory = at(assistantText("done"), "2026-07-05T00:00:01.000Z");
    // Trace append still in flight at read time: the buffered copy is the only copy.
    const diskLagged = at(assistantText("lagged"), "2026-07-05T00:00:02.000Z");
    h.controller.handleOmni(inHistory, "e1-4");
    h.controller.handleOmni(diskLagged, "e1-5");
    h.resolveLoad([at(userText("q"), "2026-07-05T00:00:00.000Z"), inHistory], {
      cursor: "e1-6",
      fragments: [],
    });
    await p;
    const texts = h.controller.model.items.filter((i) => i.kind === "assistant_text");
    expect(texts.map((i) => (i as AssistantTextItem).text)).toEqual(["done", "lagged"]);
  });

  it("subagent fragments preserve origin and land on the nested model", async () => {
    const h = createHarness();
    const p = h.controller.load();
    h.controller.handleServer({ type: "task_state", state: "running" }, "e1-2");
    h.resolveLoad([], {
      cursor: "e1-2",
      fragments: [withOrigin(partialText("start", "sub progress"), "c1")],
    });
    await p;
    const sub = h.controller.model.subagents.get("c1");
    expect(sub).toBeDefined();
    const texts = sub!.items.filter((i) => i.kind === "assistant_text");
    expect(texts).toHaveLength(1);
    expect((texts[0] as AssistantTextItem).text).toBe("sub progress");
    expect((texts[0] as AssistantTextItem).streaming).toBe(true);
  });
});

describe("windowed history: message windows, an eager backfill, a bounded run", () => {
  /** One older Task: prompt, reply, usage. */
  const OLD_TURN: OmniMessage[] = [
    at(userText("old question"), "2026-07-04T00:00:00.000Z"),
    at(assistantText("old answer"), "2026-07-04T00:00:02.000Z"),
    at(tokenUsage(counts(400), counts(400)), "2026-07-04T00:00:04.000Z"),
  ];
  /** A Task of exactly `size` messages, labelled so windows stay tellable apart. */
  const bigTurn = (label: string, size: number): OmniMessage[] => [
    at(userText(`question ${label}`), "2026-07-04T00:00:00.000Z"),
    ...Array.from({ length: size - 2 }, (_, i) =>
      at(assistantText(`answer ${label} ${i}`), "2026-07-04T00:00:01.000Z"),
    ),
    at(tokenUsage(counts(400), counts(400)), "2026-07-04T00:00:04.000Z"),
  ];
  const userTexts = (items: readonly { kind: string }[]) =>
    items.filter((i) => i.kind === "user_text").map((i) => (i as unknown as { text: string }).text);

  it("the initial load requests the TAIL window, seeds the prior stats, and backfills one more window eagerly", async () => {
    const h = createHarness();
    const p = h.controller.load();
    expect(h.pageArgs[0]).toEqual({ kind: "tail", messages: WINDOW_MESSAGES });
    h.controller.handleServer({ type: "task_state", state: "idle" });
    h.resolveLoad(
      HISTORY_TASK,
      undefined,
      null,
      pageInfo({
        before: "2:10",
        earlierTurns: 7,
        prior: { subagentTokens: 500, elapsedMs: 60_000, sessionTokens: 900, contextTokens: 800 },
      }),
    );
    await p;
    expect(h.controller.outlineOffset).toBe(7);
    // Header basis: prior elapsed + the loaded turn's own span (usage at +5s of a turn
    // starting at 0s); token cumulative = in-window session.total + prior subagent total.
    expect(h.controller.model.stats.sessionElapsedMs).toBe(60_000 + 5_000);
    const stats = h.controller.model.items.find((i) => i.kind === "task_stats") as TaskStatsItem;
    expect(stats.stats!.tokens).toBe(1000 + 500);

    // The backfill is already in flight, one window above the tail.
    expect(h.pageArgs[1]).toEqual({ kind: "before", cursor: "2:10", messages: WINDOW_MESSAGES });
    expect(h.controller.older).toEqual({ hasMore: true, loading: true, error: null });
    h.resolveLoad(OLD_TURN, undefined, null, pageInfo({ before: "1:8", earlierTurns: 6 }));
    await flush();
    expect(h.controller.windowCount).toBe(1);
    expect(h.controller.tailAttached).toBe(true);
    expect(h.controller.outlineOffset).toBe(6);
    expect(h.controller.older).toEqual({ hasMore: true, loading: false, error: null });
    expect(h.controller.newer.hasMore).toBe(false);
    // The frozen window renders BEFORE the live model, with its last Task closed
    // (finalizeHistory — a newer window follows, so the Task is complete by construction).
    expect(h.controller.items.slice(0, 3).map((i) => i.kind)).toEqual([
      "user_text",
      "assistant_text",
      "task_stats",
    ]);
    // Ids stay unique across the concatenated view (negative frozen base vs. positive live ids).
    const ids = h.controller.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(h.controller.items.slice(0, 3).every((i) => i.id < 0)).toBe(true);
    // Its cumulative stats column carries on into the live window's figures.
    const oldStats = h.controller.items.find((i) => i.kind === "task_stats") as TaskStatsItem;
    expect(oldStats.stats!.tokens).toBe(400);
  });

  it("a session that fits one window has no cursor, no backfill, and renders the live model as is", async () => {
    const h = createHarness();
    const p = h.controller.load();
    h.controller.handleServer({ type: "task_state", state: "idle" });
    h.resolveLoad(HISTORY_TASK, undefined, null, pageInfo());
    await p;
    await flush();
    expect(h.loadCalls()).toBe(1);
    expect(h.controller.older.hasMore).toBe(false);
    expect(h.controller.windowCount).toBe(0);
    expect(h.controller.items).toBe(h.controller.model.items);
    await h.controller.loadOlder();
    expect(h.loadCalls()).toBe(1);
  });

  it("loadOlder before the initial load, and loadNewer while the tail is attached, are no-ops", async () => {
    const h = createHarness();
    await h.controller.loadOlder(); // buffering phase: ignored
    await h.controller.loadNewer();
    expect(h.loadCalls()).toBe(0);
  });

  it("a failed backfill surfaces on older.error and can be retried", async () => {
    const h = createHarness();
    const p = h.controller.load();
    h.controller.handleServer({ type: "task_state", state: "idle" });
    h.resolveLoad(HISTORY_TASK, undefined, null, pageInfo({ before: "1:8", earlierTurns: 1 }));
    await p;
    h.rejectLoad(new Error("boom")); // the eager backfill
    await flush();
    expect(h.controller.older).toEqual({ hasMore: true, loading: false, error: "boom" });
    expect(h.controller.windowCount).toBe(0);
    const again = h.controller.loadOlder();
    h.resolveLoad(OLD_TURN, undefined, null, pageInfo());
    await again;
    expect(h.controller.older).toEqual({ hasMore: false, loading: false, error: null });
    expect(h.controller.windowCount).toBe(1);
  });

  /**
   * Boots a controller holding a 25-message tail plus one eagerly backfilled 25-message
   * window (window A): 50 loaded, under the budget by one more window's worth minus ten.
   */
  async function withRun(): Promise<Harness> {
    const h = createHarness();
    const p = h.controller.load();
    h.controller.handleServer({ type: "task_state", state: "idle" });
    h.resolveLoad(
      bigTurn("tail", 25),
      undefined,
      null,
      pageInfo({ before: "5:0", earlierTurns: 4 }),
    );
    await p;
    h.resolveLoad(bigTurn("A", 25), undefined, null, pageInfo({ before: "4:0", earlierTurns: 3 }));
    await flush();
    expect(h.controller.windowCount).toBe(1);
    expect(h.controller.tailAttached).toBe(true);
    return h;
  }

  it("past the budget, scrolling up sheds the live tail first, then the newest window; the run never drops below two windows", async () => {
    expect(MAX_LOADED_MESSAGES).toBe(60); // the counts below are chosen against this
    const h = await withRun();
    const edgesBefore = h.controller.edgesVersion;

    // + window B → 75 loaded: the tail is shed (50 stay), the transcript is the run alone.
    const b = h.controller.loadOlder();
    expect(h.pageArgs[2]).toEqual({ kind: "before", cursor: "4:0", messages: WINDOW_MESSAGES });
    h.resolveLoad(bigTurn("B", 25), undefined, null, pageInfo({ before: "3:0", earlierTurns: 2 }));
    await b;
    expect(h.controller.tailAttached).toBe(false);
    expect(h.controller.newer).toEqual({ hasMore: true, loading: false, error: null });
    expect(h.controller.windowCount).toBe(2);
    expect(userTexts(h.controller.items)).toEqual(["question B", "question A"]);
    expect(h.controller.outlineOffset).toBe(2);
    expect(h.controller.edgesVersion).toBeGreaterThan(edgesBefore);

    // + window C → 75 again: the newest window (A) leaves, B and C stay around the reader.
    const c = h.controller.loadOlder();
    h.resolveLoad(bigTurn("C", 25), undefined, null, pageInfo({ before: "2:0", earlierTurns: 1 }));
    await c;
    expect(h.controller.windowCount).toBe(2);
    expect(userTexts(h.controller.items)).toEqual(["question C", "question B"]);
    expect(h.controller.older.hasMore).toBe(true);

    // The live model kept streaming meanwhile: it is off screen, not gone.
    h.controller.handleOmni(at(userText("live prompt"), "2026-07-04T00:01:00.000Z"));
    expect(userTexts(h.controller.items)).toEqual(["question C", "question B"]);
    expect(userTexts(h.controller.model.items)).toContain("live prompt");

    // Scrolling back down: the next window after B, bounded by the tail's start. It is
    // window A again, and its end IS the tail's start — so the tail re-attaches, and the
    // run sheds from the top down to the budget.
    const n = h.controller.loadNewer();
    expect(h.pageArgs[4]).toEqual({
      kind: "after",
      cursor: "4:0",
      until: "5:0",
      messages: WINDOW_MESSAGES,
    });
    h.resolveLoad(
      bigTurn("A", 25),
      undefined,
      null,
      pageInfo({ before: "4:0", after: "5:0", earlierTurns: 3 }),
    );
    await n;
    expect(h.controller.tailAttached).toBe(true);
    expect(h.controller.newer).toEqual({ hasMore: false, loading: false, error: null });
    // C, B, A + tail = 101 → shed C, then B: A and the tail remain (51).
    expect(h.controller.windowCount).toBe(1);
    expect(userTexts(h.controller.items)).toEqual(["question A", "question tail", "live prompt"]);
    expect(h.controller.outlineOffset).toBe(3);
    expect(h.controller.older.hasMore).toBe(true);
    await h.controller.loadNewer(); // attached: nothing to do
    expect(h.loadCalls()).toBe(5);
  });

  it("a run that already ends at the tail's start re-attaches without a fetch", async () => {
    const h = await withRun();
    // + window B → the tail is shed with A still right below the reader: the run's end
    // IS the tail's start.
    const b = h.controller.loadOlder();
    h.resolveLoad(bigTurn("B", 25), undefined, null, pageInfo({ before: "3:0", earlierTurns: 2 }));
    await b;
    expect(h.controller.tailAttached).toBe(false);
    const calls = h.loadCalls();
    await h.controller.loadNewer();
    expect(h.loadCalls()).toBe(calls);
    expect(h.controller.tailAttached).toBe(true);
    expect(h.controller.newer.hasMore).toBe(false);
    // B, A + tail = 75 → B leaves: the tail's own units are never held twice.
    expect(userTexts(h.controller.items)).toEqual(["question A", "question tail"]);
  });

  it("a forward page short of the tail appends a window and stays detached; a failure surfaces on newer.error", async () => {
    const h = await withRun();
    // Two windows up: the tail is shed, then A — the run [C, B] ends a window short of
    // the tail, so walking down has something to fetch.
    const b = h.controller.loadOlder();
    h.resolveLoad(bigTurn("B", 25), undefined, null, pageInfo({ before: "3:0", earlierTurns: 2 }));
    await b;
    const c = h.controller.loadOlder();
    h.resolveLoad(bigTurn("C", 25), undefined, null, pageInfo({ before: "2:0", earlierTurns: 1 }));
    await c;
    expect(h.controller.tailAttached).toBe(false);
    expect(userTexts(h.controller.items)).toEqual(["question C", "question B"]);

    const failed = h.controller.loadNewer();
    h.rejectLoad(new Error("boom"));
    await failed;
    expect(h.controller.newer).toEqual({ hasMore: true, loading: false, error: "boom" });

    // A page closed by its size, not by `until`: appended, the tail still off screen.
    const n = h.controller.loadNewer();
    h.resolveLoad(
      bigTurn("A1", 5),
      undefined,
      null,
      pageInfo({ before: "4:0", after: "4:5", earlierTurns: 3 }),
    );
    await n;
    expect(h.controller.tailAttached).toBe(false);
    expect(h.controller.newer).toEqual({ hasMore: true, loading: false, error: null });
    expect(userTexts(h.controller.items)).toEqual(["question C", "question B", "question A1"]);
    // The next forward page continues from that window's end.
    void h.controller.loadNewer();
    expect(h.pageArgs[h.pageArgs.length - 1]).toEqual({
      kind: "after",
      cursor: "4:5",
      until: "5:0",
      messages: WINDOW_MESSAGES,
    });
  });

  it("jumpToLatest drops the run, re-attaches the tail, and backfills one window again", async () => {
    const h = await withRun();
    const b = h.controller.loadOlder();
    h.resolveLoad(bigTurn("B", 25), undefined, null, pageInfo({ before: "3:0", earlierTurns: 2 }));
    await b;
    expect(h.controller.tailAttached).toBe(false);
    const edgesBefore = h.controller.edgesVersion;

    h.controller.jumpToLatest();
    expect(h.controller.tailAttached).toBe(true);
    expect(h.controller.windowCount).toBe(0);
    expect(h.controller.edgesVersion).toBeGreaterThan(edgesBefore);
    expect(h.controller.newer.hasMore).toBe(false);
    expect(userTexts(h.controller.items)).toEqual(["question tail"]);
    expect(h.controller.outlineOffset).toBe(4);
    // The backfill above the tail is fetched again, from the tail's start.
    expect(h.pageArgs[h.pageArgs.length - 1]).toEqual({
      kind: "before",
      cursor: "5:0",
      messages: WINDOW_MESSAGES,
    });
    h.resolveLoad(bigTurn("A", 25), undefined, null, pageInfo({ before: "4:0", earlierTurns: 3 }));
    await flush();
    expect(h.controller.windowCount).toBe(1);
    h.controller.jumpToLatest(); // attached: nothing to do
    expect(h.controller.windowCount).toBe(1);
  });
});

describe("resync (windowed history)", () => {
  /** Boots a controller with a tail window plus the eagerly backfilled window above it. */
  async function withRun(): Promise<Harness> {
    const h = createHarness();
    const p = h.controller.load();
    h.controller.handleServer({ type: "task_state", state: "idle" });
    h.resolveLoad(HISTORY_TASK, undefined, null, pageInfo({ before: "2:10", earlierTurns: 1 }));
    await p;
    h.resolveLoad(
      [at(userText("old question"), "2026-07-04T00:00:00.000Z")],
      undefined,
      null,
      pageInfo(),
    );
    await flush();
    expect(h.controller.windowCount).toBe(1);
    return h;
  }

  it("refetches the tail from its own start cursor and keeps the run: one fetch, continuity by construction", async () => {
    const h = await withRun();
    h.controller.handleServer({ type: "resync_required" });
    expect(h.pageArgs[2]).toEqual({ kind: "after", cursor: "2:10" });
    // New units arrived since: the refetch from the same start simply holds more.
    h.resolveLoad(
      [...HISTORY_TASK, at(userText("newer question"), "2026-07-05T00:01:00.000Z")],
      undefined,
      null,
      pageInfo({ before: "2:10", earlierTurns: 1 }),
    );
    await flush();
    expect(h.loadCalls()).toBe(3); // initial + backfill + one resync fetch
    expect(h.controller.windowCount).toBe(1);
    expect(h.controller.older.hasMore).toBe(false); // the backfill already reached the beginning
    expect(h.controller.outlineOffset).toBe(0);
    expect(h.controller.items.filter((i) => i.kind === "user_text")).toHaveLength(3);
  });

  it("a tail that reaches the beginning resyncs with the full read", async () => {
    const h = createHarness();
    const p = h.controller.load();
    h.controller.handleServer({ type: "task_state", state: "idle" });
    h.resolveLoad(HISTORY_TASK, undefined, null, pageInfo({ earlierTurns: 0 }));
    await p;
    h.controller.handleServer({ type: "resync_required" });
    expect(h.pageArgs[1]).toBeUndefined();
    h.resolveLoad(HISTORY_TASK);
    await flush();
    expect(h.loadCalls()).toBe(2);
    expect(h.controller.windowCount).toBe(0);
    expect(h.controller.model.items.some((i) => i.kind === "user_text")).toBe(true);
  });

  it("a refetch the server could not honour — no envelope — falls back to the full read and drops the run", async () => {
    const h = await withRun();
    h.controller.handleServer({ type: "resync_required" });
    // A server without windowing support answers with the full transcript and no
    // envelope: doubt — the full read follows within the same rebuild.
    h.resolveLoad([...HISTORY_TASK]);
    await flush();
    expect(h.pageArgs[h.pageArgs.length - 1]).toBeUndefined();
    h.resolveLoad([at(userText("old question"), "2026-07-04T00:00:00.000Z"), ...HISTORY_TASK]);
    await flush();
    expect(h.controller.windowCount).toBe(0);
    expect(h.controller.older.hasMore).toBe(false);
    expect(h.controller.outlineOffset).toBe(0);
    // The full transcript lives in the single model now.
    expect(h.controller.model.items.filter((i) => i.kind === "user_text")).toHaveLength(2);
  });

  it("a refetch cut short (an `after` cursor came back) is doubt too: the full read", async () => {
    const h = await withRun();
    h.controller.handleServer({ type: "resync_required" });
    h.resolveLoad(
      HISTORY_TASK,
      undefined,
      null,
      pageInfo({ before: "2:10", after: "3:0", earlierTurns: 1 }),
    );
    await flush();
    expect(h.pageArgs[h.pageArgs.length - 1]).toBeUndefined();
    h.resolveLoad([at(userText("old question"), "2026-07-04T00:00:00.000Z"), ...HISTORY_TASK]);
    await flush();
    expect(h.controller.windowCount).toBe(0);
    expect(h.controller.model.items.filter((i) => i.kind === "user_text")).toHaveLength(2);
  });

  it("the tail keeps its attachment state across a resync: a shed tail stays off screen", async () => {
    const h = createHarness();
    const p = h.controller.load();
    h.controller.handleServer({ type: "task_state", state: "idle" });
    const big = (label: string) => [
      at(userText(`question ${label}`), "2026-07-04T00:00:00.000Z"),
      ...Array.from({ length: 23 }, (_, i) =>
        at(assistantText(`answer ${label} ${i}`), "2026-07-04T00:00:01.000Z"),
      ),
      at(tokenUsage(counts(400), counts(400)), "2026-07-04T00:00:04.000Z"),
    ];
    h.resolveLoad(big("tail"), undefined, null, pageInfo({ before: "5:0", earlierTurns: 4 }));
    await p;
    h.resolveLoad(big("A"), undefined, null, pageInfo({ before: "4:0", earlierTurns: 3 }));
    await flush();
    const b = h.controller.loadOlder();
    h.resolveLoad(big("B"), undefined, null, pageInfo({ before: "3:0", earlierTurns: 2 }));
    await b;
    expect(h.controller.tailAttached).toBe(false);

    h.controller.handleServer({ type: "resync_required" });
    expect(h.pageArgs[h.pageArgs.length - 1]).toEqual({ kind: "after", cursor: "5:0" });
    h.resolveLoad(big("tail"), undefined, null, pageInfo({ before: "5:0", earlierTurns: 4 }));
    await flush();
    expect(h.controller.tailAttached).toBe(false);
    expect(h.controller.windowCount).toBe(2);
    expect(h.controller.newer.hasMore).toBe(true);
  });
});

describe("history load failure and retry (#6)", () => {
  it("failure surfaces the error and stops loading; retry keeps the buffer (snapshot and initial events are not lost)", async () => {
    const h = createHarness();
    const p = h.controller.load();
    h.controller.handleServer({ type: "task_state", state: "idle" });
    h.rejectLoad(new Error("network error"));
    await p;
    expect(h.errors[h.errors.length - 1]).toBe("network error");
    expect(h.loadings[h.loadings.length - 1]).toBe(false);

    const retryP = h.controller.retry();
    h.resolveLoad(HISTORY_TASK);
    await retryP;
    expect(h.errors[h.errors.length - 1]).toBeNull();
    // The idle snapshot in the buffer isn't lost: the history-closing stats row is produced.
    expect(h.controller.model.items.some((i) => i.kind === "task_stats")).toBe(true);
  });

  it("retry without a failure is a no-op (history is not replayed twice)", async () => {
    const h = createHarness();
    const p = h.controller.load();
    h.resolveLoad(HISTORY_TASK);
    await p;
    await h.controller.retry();
    expect(h.loadCalls()).toBe(1);
  });

  it("retry after a FAILED resync rebuild rebuilds into a fresh model (no transcript duplication)", async () => {
    // A successful initial load leaves the transcript populated; a mid-stream resync whose refetch
    // then fails deliberately keeps that old transcript on screen (the atomic swap only replaces it
    // on success). Retry must therefore push the refetched history into a FRESH model — pushing it
    // onto the retained one would duplicate the whole conversation (regression guard).
    const h = createHarness();
    const p = h.controller.load();
    h.resolveLoad([
      at(userText("q1"), "2026-07-05T00:00:00.000Z"),
      at(assistantText("a1"), "2026-07-05T00:00:01.000Z"),
    ]);
    await p;
    expect(h.controller.model.items.map((i) => i.kind)).toEqual(["user_text", "assistant_text"]);

    // Resync mid-session, but the rebuild's history refetch fails.
    h.controller.handleServer({ type: "resync_required" });
    h.rejectLoad(new Error("network error"));
    await flush();
    expect(h.errors[h.errors.length - 1]).toBe("network error");
    // The old transcript is retained (not blanked) while the error/Retry state is shown.
    expect(h.controller.model.items.map((i) => i.kind)).toEqual(["user_text", "assistant_text"]);

    // Retry succeeds: the identical history must land in a fresh model, not be appended onto the retained one.
    const retryP = h.controller.retry();
    h.resolveLoad([
      at(userText("q1"), "2026-07-05T00:00:00.000Z"),
      at(assistantText("a1"), "2026-07-05T00:00:01.000Z"),
    ]);
    await retryP;
    expect(h.controller.model.items.map((i) => i.kind)).toEqual(["user_text", "assistant_text"]);
    expect(h.controller.model.items.filter((i) => i.kind === "user_text")).toHaveLength(1);
  });
});
