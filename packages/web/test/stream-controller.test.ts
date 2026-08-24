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
import { OLDER_UNITS, TAIL_UNITS, createStreamController } from "../src/lib/omni/stream-controller";
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
    const ev: ServerEvent = {
      type: "approval_request",
      toolCall: tc,
      origin: ["c1"],
      approvalTarget: { name: "mcp__github__create_issue", permission: "rw" },
    };
    h.controller.handleServer(ev);
    // The pending table is keyed by origin composite key.
    expect(h.controller.pendingApprovals.has(approvalKey(["c1"], "t1"))).toBe(true);
    expect(h.controller.pendingApprovals.has(approvalKey(undefined, "t1"))).toBe(false);
    expect(h.controller.pendingApprovals.get(approvalKey(["c1"], "t1"))?.approvalTarget).toEqual(
      ev.approvalTarget,
    );
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

describe("windowed history: tail-first load + scroll-up backfill", () => {
  const OLD_TURN: OmniMessage[] = [
    at(userText("old question"), "2026-07-04T00:00:00.000Z"),
    at(assistantText("old answer"), "2026-07-04T00:00:02.000Z"),
    at(tokenUsage(counts(400), counts(400)), "2026-07-04T00:00:04.000Z"),
  ];

  it("initial load requests the TAIL window and seeds the prior stats into the tracker", async () => {
    const h = createHarness();
    const p = h.controller.load();
    expect(h.pageArgs[0]).toEqual({ kind: "tail", limit: TAIL_UNITS });
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
    expect(h.controller.older).toEqual({ hasMore: true, loading: false, error: null });
    // Header basis: prior elapsed + the loaded turn's own span (usage at +5s of a turn
    // starting at 0s); token cumulative = in-window session.total + prior subagent total.
    expect(h.controller.model.stats.sessionElapsedMs).toBe(60_000 + 5_000);
    const stats = h.controller.model.items.find((i) => i.kind === "task_stats") as TaskStatsItem;
    expect(stats.stats!.tokens).toBe(1000 + 500);
  });

  it("loadOlder prepends the previous window: frozen items ahead of the live model, unique ids, closed stats row", async () => {
    const h = createHarness();
    const p = h.controller.load();
    h.controller.handleServer({ type: "task_state", state: "idle" });
    h.resolveLoad(HISTORY_TASK, undefined, null, pageInfo({ before: "1:8", earlierTurns: 1 }));
    await p;

    const older = h.controller.loadOlder();
    expect(h.pageArgs[1]).toEqual({ kind: "before", cursor: "1:8", limit: OLDER_UNITS });
    // Reaches the beginning: no cursor, offset drops to 0.
    h.resolveLoad(OLD_TURN, undefined, null, pageInfo({ earlierTurns: 0 }));
    await older;

    // The prepended window renders BEFORE the live model, with its last Task closed
    // (finalizeHistory — a newer window follows, so the Task is complete by construction).
    expect(h.controller.prefixItems.map((i) => i.kind)).toEqual([
      "user_text",
      "assistant_text",
      "task_stats",
    ]);
    expect(h.controller.older).toEqual({ hasMore: false, loading: false, error: null });
    expect(h.controller.outlineOffset).toBe(0);
    // Ids stay unique across the concatenated view (negative prefix base vs. positive live ids).
    const ids = [...h.controller.prefixItems, ...h.controller.model.items].map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(h.controller.prefixItems.every((i) => i.id < 0)).toBe(true);
    // Its cumulative stats column carries on into the live window's figures.
    const oldStats = h.controller.prefixItems.find((i) => i.kind === "task_stats") as TaskStatsItem;
    expect(oldStats.stats!.tokens).toBe(400);
  });

  it("loadOlder without more history, while loading, or before the initial load is a no-op", async () => {
    const h = createHarness();
    const early = h.controller.loadOlder(); // buffering phase: ignored
    await early;
    const p = h.controller.load();
    h.controller.handleServer({ type: "task_state", state: "idle" });
    h.resolveLoad(HISTORY_TASK, undefined, null, pageInfo()); // no before cursor: beginning already loaded
    await p;
    await h.controller.loadOlder();
    expect(h.loadCalls()).toBe(1);
  });

  it("a failed backfill surfaces on older.error and can be retried", async () => {
    const h = createHarness();
    const p = h.controller.load();
    h.controller.handleServer({ type: "task_state", state: "idle" });
    h.resolveLoad(HISTORY_TASK, undefined, null, pageInfo({ before: "1:8", earlierTurns: 1 }));
    await p;
    const older = h.controller.loadOlder();
    h.rejectLoad(new Error("boom"));
    await older;
    expect(h.controller.older).toEqual({ hasMore: true, loading: false, error: "boom" });
    expect(h.controller.prefixItems).toHaveLength(0);
    const again = h.controller.loadOlder();
    h.resolveLoad(OLD_TURN, undefined, null, pageInfo());
    await again;
    expect(h.controller.older.error).toBeNull();
    expect(h.controller.prefixItems.length).toBeGreaterThan(0);
  });
});

describe("resync decision tree (windowed history)", () => {
  const tailPage = pageInfo({ before: "2:10", earlierTurns: 1 });

  /** Boots a controller with a tail window + one backfilled prefix window. */
  async function withPrefix(): Promise<Harness> {
    const h = createHarness();
    const p = h.controller.load();
    h.controller.handleServer({ type: "task_state", state: "idle" });
    h.resolveLoad(HISTORY_TASK, undefined, null, tailPage);
    await p;
    const older = h.controller.loadOlder();
    h.resolveLoad(
      [at(userText("old question"), "2026-07-04T00:00:00.000Z")],
      undefined,
      null,
      pageInfo(),
    );
    await older;
    expect(h.controller.prefixItems.length).toBeGreaterThan(0);
    return h;
  }

  it("no prefix: resync refetches the TAIL window (initial-load shape)", async () => {
    const h = createHarness();
    const p = h.controller.load();
    h.controller.handleServer({ type: "task_state", state: "idle" });
    h.resolveLoad(HISTORY_TASK, undefined, null, pageInfo({ before: "2:10", earlierTurns: 3 }));
    await p;
    h.controller.handleServer({ type: "resync_required" });
    expect(h.pageArgs[1]).toEqual({ kind: "tail", limit: TAIL_UNITS });
    h.resolveLoad(HISTORY_TASK, undefined, null, pageInfo({ before: "2:10", earlierTurns: 3 }));
    await flush();
    expect(h.loadCalls()).toBe(2);
    expect(h.controller.outlineOffset).toBe(3);
    expect(h.controller.model.items.some((i) => i.kind === "user_text")).toBe(true);
  });

  it("prefix + provable continuity (identical window-start cursor): splice — prefix retained, one fetch", async () => {
    const h = await withPrefix();
    h.controller.handleServer({ type: "resync_required" });
    // The refetched tail starts at the SAME cursor the current tail started at: no new
    // units since — the new window abuts the prefix exactly.
    h.resolveLoad(HISTORY_TASK, undefined, null, tailPage);
    await flush();
    expect(h.loadCalls()).toBe(3); // initial + backfill + one resync fetch
    expect(h.controller.prefixItems.length).toBeGreaterThan(0);
    expect(h.controller.older.hasMore).toBe(false); // backfill already reached the beginning
    expect(h.controller.model.items.some((i) => i.kind === "user_text")).toBe(true);
  });

  it("prefix + moved cursor (new units arrived): doubt — falls back to the FULL refetch, prefix dropped", async () => {
    const h = await withPrefix();
    h.controller.handleServer({ type: "resync_required" });
    // The tail window slid forward: splicing would leave a gap between prefix and tail.
    h.resolveLoad([], undefined, null, pageInfo({ before: "3:0", earlierTurns: 9 }));
    await flush();
    // The fallback full read (no page argument) is issued within the same rebuild.
    expect(h.pageArgs[h.pageArgs.length - 1]).toBeUndefined();
    h.resolveLoad([at(userText("old question"), "2026-07-04T00:00:00.000Z"), ...HISTORY_TASK]);
    await flush();
    expect(h.controller.prefixItems).toHaveLength(0);
    expect(h.controller.outlineOffset).toBe(0);
    expect(h.controller.older.hasMore).toBe(false);
    // The full transcript lives in the single model now.
    expect(h.controller.model.items.filter((i) => i.kind === "user_text")).toHaveLength(2);
  });

  it("prefix + tail reaching the beginning: prefix superseded without a second fetch", async () => {
    const h = await withPrefix();
    h.controller.handleServer({ type: "resync_required" });
    h.resolveLoad(
      [at(userText("old question"), "2026-07-04T00:00:00.000Z"), ...HISTORY_TASK],
      undefined,
      null,
      pageInfo({ earlierTurns: 0 }),
    );
    await flush();
    expect(h.loadCalls()).toBe(3);
    expect(h.controller.prefixItems).toHaveLength(0);
    expect(h.controller.model.items.filter((i) => i.kind === "user_text")).toHaveLength(2);
  });

  it("a legacy full response during resync (no page envelope) resets the windowed state", async () => {
    const h = await withPrefix();
    h.controller.handleServer({ type: "resync_required" });
    // A server without windowing support answers the tail request with the full
    // transcript and no envelope: doubt — the full-fallback branch also covers it
    // (the second fetch returns the same full transcript).
    h.resolveLoad([...HISTORY_TASK]);
    await flush();
    h.resolveLoad([at(userText("old question"), "2026-07-04T00:00:00.000Z"), ...HISTORY_TASK]);
    await flush();
    expect(h.controller.prefixItems).toHaveLength(0);
    expect(h.controller.older.hasMore).toBe(false);
    expect(h.controller.outlineOffset).toBe(0);
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
