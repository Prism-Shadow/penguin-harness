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
import type { MessagesLiveTail, ServerEvent, SessionStatus } from "@prismshadow/penguin-server/api";
import { createStreamController } from "../src/lib/omni/stream-controller";
import type { StreamController } from "../src/lib/omni/stream-controller";
import { approvalKey, findToolCard } from "../src/lib/omni/stream-model";
import type { AssistantTextItem, ToolCallItem } from "../src/lib/omni/stream-model";

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
  errors: Array<string | null>;
  loadings: boolean[];
  loadCalls: () => number;
  resolveLoad: (
    messages: OmniMessage[],
    live?: MessagesLiveTail,
    serverNowMs?: number | null,
  ) => void;
  rejectLoad: (err: Error) => void;
}

function createHarness(): Harness {
  const pendingLoads: Array<{
    resolve: (m: {
      messages: OmniMessage[];
      live?: MessagesLiveTail;
      serverNowMs?: number | null;
    }) => void;
    reject: (e: unknown) => void;
  }> = [];
  const states: SessionStatus[] = [];
  const errors: Array<string | null> = [];
  const loadings: boolean[] = [];
  let calls = 0;
  const controller = createStreamController({
    loadMessages: () =>
      new Promise<{
        messages: OmniMessage[];
        live?: MessagesLiveTail;
        serverNowMs?: number | null;
      }>((resolve, reject) => {
        calls += 1;
        pendingLoads.push({ resolve, reject });
      }),
    onTaskState: (s) => states.push(s),
    onLoading: (l) => loadings.push(l),
    onError: (e) => errors.push(e),
    onModelChange: () => {},
    onPendingChange: () => {},
    now: () => 1_000_000,
  });
  return {
    controller,
    states,
    errors,
    loadings,
    loadCalls: () => calls,
    resolveLoad: (messages, live, serverNowMs) =>
      pendingLoads.shift()!.resolve({
        messages,
        ...(live !== undefined ? { live } : {}),
        ...(serverNowMs !== undefined ? { serverNowMs } : {}),
      }),
    rejectLoad: (err) => pendingLoads.shift()!.reject(err),
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
