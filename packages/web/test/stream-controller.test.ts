/**
 * stream-controller.ts unit tests: buffer/replay phase machine, task_state as the
 * authoritative state while streaming (history-closing decision), the generation guard
 * against rebuild re-entrancy during replay, resync rebuild (clears the pending table +
 * keeps localDecisions), approval re-delivery keyed by origin composite key + missing
 * card backfill, the local answer time an optimistic resolveApproval stamps, and history
 * load failure/retry.
 *
 * Windowed history: a conversation opens on its newest 20 Q&A pairs and each scroll to the top
 * asks for 20 more; a page the server cut short at its byte budget still offers the history
 * before it; a user image the page carries by reference and the stream's inline copy of it
 * draw one picture.
 *
 * History over the stream (lib/history, the `history` stream's reads):
 * - Given a conversation opened, the first read asks for the newest Tasks within the first-paint
 *   budget and the fill behind them; once its window is on screen, older windows follow, each
 *   asking for the Tasks still missing, until 20 Tasks are on screen — and none once they are.
 * - Given the beginning reached before 20 Tasks, no further window is asked for.
 * - Given an older window landing, the transcript below it is untouched: the same items, the
 *   same ids, so the reading position holds.
 * - Given a machine's read reporting progress, it shows as the window's until the window is on
 *   screen, then as the fill's until the fill ends, and an older window's as its own.
 * - Given the reader leaves (dispose), every read the conversation opened is closed — the fill
 *   behind the transcript included — and nothing it sends afterwards lands.
 * - Given a stream dropped mid-window and re-issued, frames sent again are not taken twice, and
 *   a window rebuilt under a new id replaces the one in part: every record lands once.
 * - Given a stream that lost frames, it is read again from scratch, a couple of times, and then
 *   the load fails with an error rather than a window with a hole in it.
 * - Given a stream that closes a window it never began (the server ends the stream after `done`),
 *   it is closed and read again, never left for the socket to re-issue for ever.
 * - Given a live event equal to a history record that came folded (a long thinking block), the
 *   event is dropped as a duplicate: the block is drawn once.
 * - Given the window read waiting on the machine, Retry now opens it again.
 * - Given an item with folded values unfolded, each value is fetched by its ref, the item shows
 *   the whole values once all have arrived, and a failed fetch is said on the item and starts
 *   over on the next unfold.
 *
 * Memory updates when session_meta falls before the window:
 * - Given a completed tail, loading it shows one update per topic, excluding the index.
 * - Given a running tail, edits received live show the same updates when the Task finishes.
 * - Given an older page, loading it adds that page's updates without mixing them into the tail.
 * - Given a reconnect, rebuilding the tail preserves its updates without duplicating them.
 */
import { describe, expect, it } from "vitest";
import {
  approvalDecision,
  assistantText,
  compactionBegin,
  compactionEnd,
  imageUrlMessage,
  partialText,
  partialToolCallOutput,
  sessionMeta,
  thinkingMessage,
  tokenUsage,
  toolCall,
  toolCallOutput,
  userText,
  withOrigin,
} from "@prismshadow/amsp";
import type { AmspRecord, TokenCounts } from "@prismshadow/amsp";
import type {
  HistoryMessage,
  MessagesLiveTail,
  MessagesPageInfo,
  PendingFollowUpInfo,
  PendingSteeringInfo,
  ServerEvent,
  SessionStatus,
} from "@prismshadow/penguin-server/api";
import type { HistoryStreamQuery } from "../src/api/sse";
import {
  FIRST_PAINT_BYTES,
  OLDER_UNITS,
  TAIL_UNITS,
  createStreamController,
} from "../src/lib/amsp/stream-controller";
import type { HistoryTransfer, StreamController } from "../src/lib/amsp/stream-controller";
import { elideHistoryRecord } from "@prismshadow/penguin-core/interfaces";
import { FakeHistoryStream, deliver, progressOf, windowEvents } from "./helpers/history-stream";
import { approvalKey, findToolCard } from "../src/lib/amsp/stream-model";
import type {
  AssistantTextItem,
  ChatItem,
  TaskStatsItem,
  ToolCallItem,
  UserImageItem,
} from "../src/lib/amsp/stream-model";

/** Override a message timestamp (constructor defaults to the current time). */
function at<M extends AmspRecord>(msg: M, ts: string): M {
  return { ...msg, timestamp: ts };
}

function counts(total: number): TokenCounts {
  return { cache_read: 0, cache_write: 0, output: 0, total };
}

/** Flush microtasks/macrotasks: let async loads started inside rebuild finish. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

interface Harness {
  controller: StreamController;
  stream: FakeHistoryStream;
  states: SessionStatus[];
  pendingSteering: PendingSteeringInfo[][];
  returnedSteering: PendingSteeringInfo[][];
  pendingFollowUps: PendingFollowUpInfo[][];
  errors: Array<string | null>;
  loadings: boolean[];
  transfers: HistoryTransfer[];
  /** History reads opened so far. */
  loadCalls: () => number;
  /** The query of each history read, in the order they were opened. */
  queries: () => HistoryStreamQuery[];
  /** Answers the oldest open window read (a tail, or the whole transcript) with a window. */
  resolveLoad: (
    messages: AmspRecord[],
    live?: MessagesLiveTail,
    serverNowMs?: number | null,
    page?: MessagesPageInfo,
  ) => void;
  /** Fails the oldest open window read. */
  rejectLoad: (err: Error) => void;
  /** Answers the oldest open older-window read (`before`). */
  resolveOlder: (messages: AmspRecord[], page: MessagesPageInfo) => void;
  /** Fails the oldest open older-window read. */
  rejectOlder: (err: Error) => void;
}

const isWindowRead = (q: HistoryStreamQuery) => q.kind === "tail" || q.kind === "full";
const isOlderRead = (q: HistoryStreamQuery) => q.kind === "before";

function createHarness(): Harness {
  const stream = new FakeHistoryStream();
  const states: SessionStatus[] = [];
  const pendingSteering: PendingSteeringInfo[][] = [];
  const returnedSteering: PendingSteeringInfo[][] = [];
  const pendingFollowUps: PendingFollowUpInfo[][] = [];
  const errors: Array<string | null> = [];
  const loadings: boolean[] = [];
  const transfers: HistoryTransfer[] = [];
  const controller = createStreamController({
    sessionId: "s1",
    openHistory: stream.open,
    openBody: stream.openBody,
    onTransfer: (t) => transfers.push(t),
    onTaskState: (s) => states.push(s),
    onPendingSteering: (items) => pendingSteering.push(items),
    onReturnedSteering: (items) => returnedSteering.push(items),
    onPendingFollowUps: (items) => pendingFollowUps.push(items),
    onLoading: (l) => loadings.push(l),
    onError: (e) => errors.push(e),
    onModelChange: () => {},
    onPendingChange: () => {},
    now: () => 1_000_000,
  });
  return {
    controller,
    stream,
    states,
    pendingSteering,
    returnedSteering,
    pendingFollowUps,
    errors,
    loadings,
    transfers,
    loadCalls: () => stream.reads.length,
    queries: () => stream.reads.map((r) => r.query),
    resolveLoad: (messages, live, serverNowMs, page) =>
      stream.window(stream.next(isWindowRead), {
        messages: messages as HistoryMessage[],
        ...(live !== undefined ? { live } : {}),
        ...(serverNowMs !== undefined ? { serverNowMs } : {}),
        ...(page !== undefined ? { page } : {}),
      }),
    rejectLoad: (err) => stream.fail(stream.next(isWindowRead), err.message),
    resolveOlder: (messages, page) =>
      stream.window(stream.next(isOlderRead), { messages: messages as HistoryMessage[], page }),
    rejectOlder: (err) => stream.fail(stream.next(isOlderRead), err.message),
  };
}

/** The first read's query: the newest Tasks within the first-paint budget, and (on a first load) the fill. */
const FIRST_PAINT = { kind: "tail", limit: TAIL_UNITS, budget: FIRST_PAINT_BYTES } as const;

/** Shorthand for a page envelope (zeroed priors unless overridden). */
function pageInfo(over: Partial<MessagesPageInfo> = {}): MessagesPageInfo {
  return {
    earlierTurns: 0,
    prior: {
      subagentTokens: 0,
      elapsedMs: 0,
      apiMs: 0,
      toolMs: 0,
      sessionTokens: 0,
      contextTokens: 0,
    },
    ...over,
  };
}

const HISTORY_TASK: AmspRecord[] = [
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

  it("reports steering the run handed back, so the composer can take it into its draft", async () => {
    const h = createHarness();
    void h.controller.load();
    // The interrupt case: the run went idle and reported the message it never delivered.
    h.controller.handleServer({
      type: "task_state",
      state: "idle",
      returnedSteering: [{ id: "st-1", text: "wait", images: 0, files: 1 }],
    });
    // Once the composer has taken it, the next event omits the field — reported as empty.
    h.controller.handleServer({ type: "task_state", state: "idle" });
    expect(h.returnedSteering).toEqual([[{ id: "st-1", text: "wait", images: 0, files: 1 }], []]);
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
    h.controller.handleRecord(at(userText("follow-up"), "2026-07-05T00:01:00.000Z"));
    h.controller.handleServer({ type: "task_state", state: "running", queued: 0 });
    h.controller.handleRecord(at(assistantText("follow-up answer"), "2026-07-05T00:01:03.000Z"));
    h.controller.handleRecord(
      at(tokenUsage(counts(1400), counts(400)), "2026-07-05T00:01:05.000Z"),
    );
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
    h.controller.handleRecord(withOrigin(approvalDecision("allow", "t1"), "c1"));
    expect(h.controller.pendingApprovals.size).toBe(0);
  });

  it("an optimistic resolveApproval stamps this end's answer time, and the later approval_decision fills approvalAtMs without moving it", async () => {
    const h = createHarness();
    const p = h.controller.load();
    const tc = toolCall({
      name: "exec_command",
      arguments: '{"cmd":"pnpm dev"}',
      toolCallId: "t1",
    });
    h.resolveLoad([at(tc, "2026-07-05T00:00:00.000Z")]);
    await p;
    h.controller.handleServer({ type: "approval_request", toolCall: tc });
    h.controller.resolveApproval(approvalKey(undefined, "t1"));
    const card = findToolCard(h.controller.model, undefined, "t1") as ToolCallItem;
    // The injected clock: clicking removes the pending entry a broadcast before the decision
    // event, and the card carries the moment this end answered for that whole window.
    expect(card.localApprovalAtMs).toBe(1_000_000);
    expect(card.approvalAtMs).toBeUndefined();

    // The event arrives afterwards. approvalAtMs takes the server timestamp — noteApprovalWait
    // subtracts another server time from it, so it must never be handed a local clock — while
    // the local stamp stays put, which is what keeps an elapsed-time gate reading it
    // local-first from seeing its start time move and restarting.
    h.controller.handleRecord(at(approvalDecision("allow", "t1"), "2026-07-05T00:00:05.000Z"));
    expect(card.approvalAtMs).toBe(Date.parse("2026-07-05T00:00:05.000Z"));
    expect(card.localApprovalAtMs).toBe(1_000_000);
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
    h.controller.handleRecord(at(assistantText("old event A"), "2026-07-05T00:00:01.000Z"));
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
    h.controller.handleRecord(live);
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
    h.controller.handleRecord(partialText("start", "Hel"), "e1-4");
    h.controller.handleRecord(partialText("delta", "lo"), "e1-5");
    // After the cursor: continues the seeded fragment.
    h.controller.handleRecord(partialText("delta", " world"), "e1-6");
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
    h.controller.handleRecord(
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
    h.controller.handleRecord(partialText("start", "He"), "old-4");
    h.controller.handleRecord(partialText("delta", "llo"), "old-5");
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
    h.controller.handleRecord(inHistory, "e1-4");
    h.controller.handleRecord(diskLagged, "e1-5");
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
  const OLD_TURN: AmspRecord[] = [
    at(userText("old question"), "2026-07-04T00:00:00.000Z"),
    at(assistantText("old answer"), "2026-07-04T00:00:02.000Z"),
    at(tokenUsage(counts(400), counts(400)), "2026-07-04T00:00:04.000Z"),
  ];
  /** `n` Tasks of one question and one answer each, a minute apart on day `day`. */
  const turns = (n: number, day = "04"): AmspRecord[] =>
    Array.from({ length: n }, (_, i) => {
      const minute = String(i).padStart(2, "0");
      return [
        at(userText(`question ${i}`), `2026-07-${day}T00:${minute}:00.000Z`),
        at(assistantText(`answer ${i}`), `2026-07-${day}T00:${minute}:30.000Z`),
      ];
    }).flat();

  it("the first read asks for the newest Tasks within the first-paint budget, then older windows follow until 20 Tasks are on screen", async () => {
    const h = createHarness();
    const p = h.controller.load();
    h.controller.handleServer({ type: "task_state", state: "idle" });
    // One Task fits the budget: the first paint, with the fill behind it.
    h.resolveLoad(HISTORY_TASK, undefined, null, pageInfo({ before: "2:10", earlierTurns: 40 }));
    await p;
    h.resolveOlder(turns(5), pageInfo({ before: "2:4", earlierTurns: 35 }));
    await flush();
    h.resolveOlder(turns(14, "03"), pageInfo({ before: "1:30", earlierTurns: 21 }));
    await flush();
    // Each older window asks for what is still missing of the 20, and none once they are there.
    expect(h.queries()).toEqual([
      { ...FIRST_PAINT, fill: true },
      { kind: "before", cursor: "2:10", limit: 19 },
      { kind: "before", cursor: "2:4", limit: 14 },
    ]);
    expect(h.controller.older).toEqual({ hasMore: true, loading: false, error: null });
    // Then each scroll to the top asks for 20 more.
    const scroll = h.controller.loadOlder();
    h.resolveOlder(OLD_TURN, pageInfo({ earlierTurns: 0 }));
    await scroll;
    expect(h.queries()[3]).toEqual({ kind: "before", cursor: "1:30", limit: OLDER_UNITS });
    expect(h.controller.older.hasMore).toBe(false);
  });

  it("asks for no further window once the beginning is reached short of 20 Tasks", async () => {
    const h = createHarness();
    const p = h.controller.load();
    h.controller.handleServer({ type: "task_state", state: "idle" });
    h.resolveLoad(HISTORY_TASK, undefined, null, pageInfo({ before: "2:10", earlierTurns: 1 }));
    await p;
    h.resolveOlder(OLD_TURN, pageInfo({ earlierTurns: 0 }));
    await flush();
    expect(h.loadCalls()).toBe(2);
    expect(h.controller.older.hasMore).toBe(false);
  });

  it("an older window lands above the transcript without touching it, so the reading position holds", async () => {
    const h = createHarness();
    const p = h.controller.load();
    h.controller.handleServer({ type: "task_state", state: "idle" });
    h.resolveLoad(HISTORY_TASK, undefined, null, pageInfo({ before: "1:8", earlierTurns: 1 }));
    await p;
    const before = [...h.controller.model.items];
    h.resolveOlder(OLD_TURN, pageInfo({ earlierTurns: 0 }));
    await flush();
    expect(h.controller.model.items).toEqual(before);
    expect(h.controller.model.items.map((i) => i.id)).toEqual(before.map((i) => i.id));
    expect(h.controller.prefixItems.length).toBeGreaterThan(0);
  });

  it("a page the server cut short of its limit still offers the history before it, on both ends", async () => {
    const h = createHarness();
    const p = h.controller.load();
    h.controller.handleServer({ type: "task_state", state: "idle" });
    // One unit where twenty were asked for: the byte budget cut the tail, and its cursor says so.
    h.resolveLoad(HISTORY_TASK, undefined, null, pageInfo({ before: "2:40", earlierTurns: 30 }));
    await p;
    expect(h.controller.older.hasMore).toBe(true);
    // A backfill cut short the same way keeps the way back open at its own cursor.
    h.resolveOlder(OLD_TURN, pageInfo({ before: "2:12", earlierTurns: 29 }));
    await flush();
    expect(h.controller.older.hasMore).toBe(true);
    expect(h.controller.outlineOffset).toBe(29);
    expect(h.queries()[2]).toEqual({ kind: "before", cursor: "2:12", limit: 18 });
    h.resolveOlder(OLD_TURN, pageInfo({ earlierTurns: 0 }));
    await flush();
    expect(h.controller.older.hasMore).toBe(false);
  });

  it("a user image the page carries by reference and the stream's inline copy of it draw one picture", async () => {
    const h = createHarness();
    const p = h.controller.load();
    const bytes = "data:image/png;base64,iVBORw0KGgo=";
    const ref = "/api/sessions/s1/trace-image?file=2&ordinal=8";
    const prompt = at(userText("what is this?"), "2026-07-05T00:00:00.000Z");
    const sent = at(imageUrlMessage(bytes), "2026-07-05T00:00:00.000Z");
    // The stream delivered the image while the page was being read: the buffered copy has its bytes.
    h.controller.handleRecord(prompt, "e1-1");
    h.controller.handleRecord(sent, "e1-2");
    h.controller.handleServer({ type: "task_state", state: "idle" });
    // The page's copies: positioned Trace records, the image's bytes replaced by its route URL.
    const pagePrompt = { ...prompt, tracePosition: { fileIndex: 2, ordinal: 7 } };
    const pageImage = {
      ...sent,
      payload: { ...sent.payload, image_url: ref },
      tracePosition: { fileIndex: 2, ordinal: 8 },
    };
    h.resolveLoad([pagePrompt, pageImage, ...HISTORY_TASK.slice(1)], undefined, null, pageInfo());
    await p;
    const images = h.controller.model.items.filter((i) => i.kind === "user_image");
    expect(images.map((i) => (i as UserImageItem).imageUrl)).toEqual([ref]);
    expect(h.controller.model.items.filter((i) => i.kind === "user_text")).toHaveLength(1);
  });

  it("initial load seeds the tail window's prior stats into the tracker", async () => {
    const h = createHarness();
    const p = h.controller.load();
    h.controller.handleServer({ type: "task_state", state: "idle" });
    h.resolveLoad(
      HISTORY_TASK,
      undefined,
      null,
      pageInfo({
        before: "2:10",
        earlierTurns: 7,
        prior: {
          subagentTokens: 500,
          elapsedMs: 60_000,
          apiMs: 25_000,
          toolMs: 20_000,
          sessionTokens: 900,
          contextTokens: 800,
        },
      }),
    );
    await p;
    expect(h.controller.outlineOffset).toBe(7);
    expect(h.controller.older.hasMore).toBe(true);
    // Header basis: prior elapsed + the loaded turn's own span (usage at +5s of a turn
    // starting at 0s); token cumulative = in-window session.total + prior subagent total.
    expect(h.controller.model.stats.sessionElapsedMs).toBe(60_000 + 5_000);
    // The breakdown reloads with its total, so a windowed load never shows a full elapsed time
    // beside components covering only the window.
    expect(h.controller.model.stats.sessionLlmMs).toBe(25_000);
    expect(h.controller.model.stats.sessionToolMs).toBe(20_000);
    const stats = h.controller.model.items.find((i) => i.kind === "task_stats") as TaskStatsItem;
    expect(stats.stats!.tokens).toBe(1000 + 500);
  });

  it("an older window is prepended: frozen items ahead of the live model, unique ids, closed stats row", async () => {
    const h = createHarness();
    const p = h.controller.load();
    h.controller.handleServer({ type: "task_state", state: "idle" });
    h.resolveLoad(HISTORY_TASK, undefined, null, pageInfo({ before: "1:8", earlierTurns: 1 }));
    await p;

    // Reaches the beginning: no cursor, offset drops to 0.
    h.resolveOlder(OLD_TURN, pageInfo({ earlierTurns: 0 }));
    await flush();

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

  it("a window is seeded with the model of the context it starts in: its first Tasks name it and a switch further down is marked, in the tail and in a backfilled window alike", async () => {
    const metaOn = (provider: string, modelId: string): AmspRecord =>
      sessionMeta({
        session_id: "s1",
        provider,
        model_id: modelId,
        model_context_window: 1000,
        system_prompt: "",
        agent_state: "/tmp/a",
        workspace: "/tmp/w",
        source: "user",
      });
    const A = { provider: "anthropic", modelId: "a-1" };
    const B = { provider: "openai", modelId: "b-2" };
    const h = createHarness();
    const p = h.controller.load();
    h.controller.handleServer({ type: "task_state", state: "idle" });
    // The tail starts partway into a context on a-1 — no meta of it in the window — and crosses
    // a switch: an ordinary manual compaction, then the next context's meta on b-2.
    h.resolveLoad(
      [
        ...HISTORY_TASK,
        at(
          compactionBegin({ reason: "manual", mode: "summarize", context: 1000, turns: 1 }),
          "2026-07-05T00:01:00.000Z",
        ),
        at(
          compactionEnd({ reason: "manual", mode: "summarize", status: "completed" }),
          "2026-07-05T00:01:05.000Z",
        ),
        at(metaOn(B.provider, B.modelId), "2026-07-05T00:01:06.000Z"),
        at(userText("next question"), "2026-07-05T00:02:00.000Z"),
        at(assistantText("next answer"), "2026-07-05T00:02:03.000Z"),
        at(tokenUsage(counts(300), counts(300)), "2026-07-05T00:02:05.000Z"),
      ],
      undefined,
      null,
      pageInfo({ before: "1:8", earlierTurns: 1, contextModel: A }),
    );
    await p;
    const items = h.controller.model.items;
    const stats = items.filter((i) => i.kind === "task_stats") as TaskStatsItem[];
    expect(stats.map((s) => s.model)).toEqual([A, B]);
    expect(items.filter((i) => i.kind === "model_change")).toMatchObject([{ from: A, to: B }]);
    // The running context is the one the window ends in, under the Session the stream is of.
    expect(h.controller.model.contextModel).toEqual({ sessionId: "s1", ...B });

    // The window before starts in an earlier context of its own.
    const C = { provider: "zhipu", modelId: "c-0" };
    h.resolveOlder(OLD_TURN, pageInfo({ earlierTurns: 0, contextModel: C }));
    await flush();
    const oldStats = h.controller.prefixItems.find((i) => i.kind === "task_stats") as TaskStatsItem;
    expect(oldStats.model).toEqual(C);
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

  it("a failed backfill surfaces on older.error, stops the backfill, and can be retried", async () => {
    const h = createHarness();
    const p = h.controller.load();
    h.controller.handleServer({ type: "task_state", state: "idle" });
    h.resolveLoad(HISTORY_TASK, undefined, null, pageInfo({ before: "1:8", earlierTurns: 1 }));
    await p;
    h.rejectOlder(new Error("boom"));
    await flush();
    expect(h.controller.older).toEqual({ hasMore: true, loading: false, error: "boom" });
    expect(h.controller.prefixItems).toHaveLength(0);
    expect(h.loadCalls()).toBe(2);
    const again = h.controller.loadOlder();
    h.resolveOlder(OLD_TURN, pageInfo());
    await again;
    expect(h.controller.older.error).toBeNull();
    expect(h.controller.prefixItems.length).toBeGreaterThan(0);
  });
});

describe("memory updates in paginated history", () => {
  const agentState = "/recorded/agents/memory-agent/agent_state";
  const page = pageInfo({ before: "1:8", earlierTurns: 1, agentState });
  const changes = (items: readonly ChatItem[]) =>
    items.flatMap((item) => (item.kind === "task_stats" ? (item.memoryChanges ?? []) : []));

  function memoryTurn(file: string, day = "05"): AmspRecord[] {
    const stamp = (message: AmspRecord, second: number) =>
      at(message, `2026-07-${day}T00:00:${String(second).padStart(2, "0")}.000Z`);
    return [
      stamp(userText("remember this"), 0),
      ...[file, file, "MEMORY.md"].flatMap((name, i) => [
        stamp(
          toolCall({
            name: "edit_file",
            arguments: JSON.stringify({ file_path: `${agentState}/memory/user/${name}` }),
            toolCallId: `${file}-${i}`,
          }),
          1 + i * 2,
        ),
        stamp(
          toolCallOutput({ output: "updated", toolCallId: `${file}-${i}`, status: "completed" }),
          2 + i * 2,
        ),
      ]),
      stamp(assistantText("remembered"), 7),
    ];
  }

  it.each(["idle", "running"] as const)(
    "a %s tail without session_meta shows one update for repeated topic edits",
    async (state) => {
      const h = createHarness();
      const pending = h.controller.load();
      h.controller.handleServer({ type: "task_state", state });
      const messages = memoryTurn("local-dev-instance.md");
      h.resolveLoad(state === "idle" ? messages : messages.slice(0, 1), undefined, null, page);
      await pending;
      if (state === "running") {
        for (const message of messages.slice(1)) h.controller.handleRecord(message);
        h.controller.handleServer({ type: "task_state", state: "idle" });
      }
      expect(changes(h.controller.model.items)).toMatchObject([
        { scope: "user", file: "local-dev-instance.md", op: "edit" },
      ]);
    },
  );

  it("an older page restores its own memory updates without mixing them into the tail", async () => {
    const h = createHarness();
    const pending = h.controller.load();
    h.controller.handleServer({ type: "task_state", state: "idle" });
    h.resolveLoad(memoryTurn("recent.md"), undefined, null, page);
    await pending;

    h.resolveOlder(memoryTurn("older.md", "04"), pageInfo({ before: "1:2", agentState }));
    await flush();
    expect(changes(h.controller.prefixItems)).toMatchObject([
      { scope: "user", file: "older.md", op: "edit" },
    ]);
    expect(changes(h.controller.model.items)).toMatchObject([
      { scope: "user", file: "recent.md", op: "edit" },
    ]);
  });

  it("reconnecting preserves the tail's memory updates without duplicating them", async () => {
    const h = createHarness();
    const pending = h.controller.load();
    h.controller.handleServer({ type: "task_state", state: "idle" });
    const messages = memoryTurn("local-dev-instance.md");
    h.resolveLoad(messages, undefined, null, page);
    await pending;

    h.controller.handleServer({ type: "resync_required" });
    h.resolveLoad(messages, undefined, null, page);
    await flush();
    expect(changes(h.controller.model.items)).toMatchObject([
      { scope: "user", file: "local-dev-instance.md", op: "edit" },
    ]);
  });
});

describe("resync decision tree (windowed history)", () => {
  const tailPage = pageInfo({ before: "2:10", earlierTurns: 1 });

  /** Boots a controller with a tail window + one backfilled prefix window reaching the beginning. */
  async function withPrefix(): Promise<Harness> {
    const h = createHarness();
    const p = h.controller.load();
    h.controller.handleServer({ type: "task_state", state: "idle" });
    h.resolveLoad(HISTORY_TASK, undefined, null, tailPage);
    await p;
    h.resolveOlder([at(userText("old question"), "2026-07-04T00:00:00.000Z")], pageInfo());
    await flush();
    expect(h.controller.prefixItems.length).toBeGreaterThan(0);
    return h;
  }

  it("no prefix: resync refetches the tail exactly as the first paint read it, without a second fill", async () => {
    const h = createHarness();
    const p = h.controller.load();
    h.controller.handleServer({ type: "task_state", state: "idle" });
    h.resolveLoad(HISTORY_TASK, undefined, null, pageInfo({ earlierTurns: 3 }));
    await p;
    h.controller.handleServer({ type: "resync_required" });
    // The first read's fill still runs behind the transcript: the refetch does not ask again.
    expect(h.queries()[1]).toEqual(FIRST_PAINT);
    h.resolveLoad(HISTORY_TASK, undefined, null, pageInfo({ earlierTurns: 3 }));
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

  it("prefix + moved cursor (new units arrived): doubt — the prefix is dropped and the new tail is backfilled again, never the whole transcript", async () => {
    const h = await withPrefix();
    h.controller.handleServer({ type: "resync_required" });
    // The tail window slid forward: splicing would leave a gap between prefix and tail.
    h.resolveLoad(HISTORY_TASK, undefined, null, pageInfo({ before: "3:0", earlierTurns: 9 }));
    await flush();
    expect(h.queries().some((q) => q.kind === "full")).toBe(false);
    expect(h.controller.prefixItems).toHaveLength(0);
    expect(h.controller.outlineOffset).toBe(9);
    // The windows behind the new tail are read again from its own cursor.
    expect(h.queries()[h.loadCalls() - 1]).toEqual({ kind: "before", cursor: "3:0", limit: 19 });
    h.resolveOlder([at(userText("old question"), "2026-07-04T00:00:00.000Z")], pageInfo());
    await flush();
    expect(h.controller.prefixItems.filter((i) => i.kind === "user_text")).toHaveLength(1);
    expect(h.controller.model.items.filter((i) => i.kind === "user_text")).toHaveLength(1);
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

  it("a response without a page envelope during resync resets the windowed state", async () => {
    const h = await withPrefix();
    h.controller.handleServer({ type: "resync_required" });
    // A window with no envelope holds the whole transcript: nothing older exists.
    h.resolveLoad([at(userText("old question"), "2026-07-04T00:00:00.000Z"), ...HISTORY_TASK]);
    await flush();
    expect(h.loadCalls()).toBe(3);
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

describe("history over the stream", () => {
  const idle: ServerEvent = { type: "task_state", state: "idle" };

  it("a machine's read shows the window's progress until the window is on screen, then the fill's until it is filled", async () => {
    const h = createHarness();
    const p = h.controller.load();
    const read = h.stream.reads[0]!;
    h.stream.progress(read, progressOf("window", 10_000, 40_000));
    expect(h.controller.transfer).toEqual({
      window: progressOf("window", 10_000, 40_000),
      older: null,
      fill: null,
    });
    h.resolveLoad(HISTORY_TASK, undefined, null, pageInfo());
    await p;
    expect(h.controller.transfer.window).toBeNull();
    h.stream.progress(read, progressOf("fill", 1_000, 9_000_000));
    expect(h.controller.transfer.fill).toEqual(progressOf("fill", 1_000, 9_000_000));
    read.handlers.onFilled?.();
    expect(h.controller.transfer).toEqual({ window: null, older: null, fill: null });
    // A read with an end: closed by its reader, or the socket would read the window again.
    expect(read.closed).toBe(true);
  });

  it("an older window's progress shows as its own while it comes over", async () => {
    const h = createHarness();
    const p = h.controller.load();
    h.resolveLoad(HISTORY_TASK, undefined, null, pageInfo({ before: "1:8", earlierTurns: 1 }));
    await p;
    const older = h.stream.next((q) => q.kind === "before");
    h.stream.progress(older, progressOf("window", 2_000, 90_000));
    expect(h.controller.transfer.older).toEqual(progressOf("window", 2_000, 90_000));
    h.resolveOlder(HISTORY_TASK, pageInfo());
    await flush();
    expect(h.controller.transfer.older).toBeNull();
  });

  it("leaving the conversation closes every read it opened, the fill included, and nothing sent afterwards lands", async () => {
    const h = createHarness();
    const p = h.controller.load();
    h.controller.handleServer(idle);
    h.resolveLoad(HISTORY_TASK, undefined, null, pageInfo({ before: "1:8", earlierTurns: 1 }));
    await p;
    expect(h.stream.reads.filter((r) => !r.closed)).toHaveLength(2); // the fill, and an older window
    h.controller.dispose();
    expect(h.stream.reads.every((r) => r.closed)).toBe(true);
    h.stream.window(h.stream.reads[1]!, {
      messages: [at(userText("late"), "2026-07-04T00:00:00.000Z")] as HistoryMessage[],
      page: pageInfo(),
    });
    await flush();
    expect(h.controller.prefixItems).toHaveLength(0);
  });

  /** Three Tasks, one of whose answers is longer than a frame. */
  const LONG_WINDOW: HistoryMessage[] = [
    at(userText("q1"), "2026-07-05T00:00:00.000Z"),
    at(assistantText("a".repeat(500)), "2026-07-05T00:00:01.000Z"),
    at(userText("q2"), "2026-07-05T00:01:00.000Z"),
    at(assistantText("a2"), "2026-07-05T00:01:01.000Z"),
    at(userText("q3"), "2026-07-05T00:02:00.000Z"),
    at(assistantText("a3"), "2026-07-05T00:02:01.000Z"),
  ];
  const userTexts = (h: Harness) =>
    h.controller.model.items.filter((i) => i.kind === "user_text").map((i) => i.text);

  it("a stream re-issued mid-window takes no frame twice: the server goes on from the last id, re-sending the frame in flight", async () => {
    const h = createHarness();
    const p = h.controller.load();
    h.controller.handleServer(idle);
    const read = h.stream.reads[0]!;
    const events = windowEvents({ messages: LONG_WINDOW, page: pageInfo() }, { frameChars: 200 });
    expect(events.some((e) => e.name === "part")).toBe(true);
    const cut = 3;
    deliver(read.handlers, events.slice(0, cut));
    deliver(read.handlers, events.slice(cut - 1));
    await p;
    expect(userTexts(h)).toEqual(["q1", "q2", "q3"]);
    const long = h.controller.model.items.find((i) => i.kind === "assistant_text");
    expect(long?.kind === "assistant_text" && long.text).toBe("a".repeat(500));
  });

  it("a window rebuilt under a new id after a drop replaces the one in part: every record lands once", async () => {
    const h = createHarness();
    const p = h.controller.load();
    h.controller.handleServer(idle);
    const read = h.stream.reads[0]!;
    const content = { messages: LONG_WINDOW, page: pageInfo() };
    deliver(read.handlers, windowEvents(content, { windowId: "w1", frameChars: 200 }).slice(0, 4));
    deliver(read.handlers, windowEvents(content, { windowId: "w2", frameChars: 200 }));
    await p;
    expect(userTexts(h)).toEqual(["q1", "q2", "q3"]);
  });

  it("a stream that lost frames is read again from scratch, and one that keeps losing them fails", async () => {
    const h = createHarness();
    const p = h.controller.load();
    const events = windowEvents({ messages: LONG_WINDOW, page: pageInfo() }, { frameChars: 200 });
    // The frame right after the page never arrived: what follows starts past what is held.
    const lost = [events[0]!, ...events.slice(2)];
    deliver(h.stream.reads[0]!.handlers, lost);
    expect(h.stream.reads[0]!.closed).toBe(true);
    expect(h.stream.reads).toHaveLength(2);
    deliver(h.stream.reads[1]!.handlers, lost);
    deliver(h.stream.reads[2]!.handlers, lost);
    await p;
    expect(h.stream.reads).toHaveLength(3);
    expect(h.stream.reads.every((r) => r.closed)).toBe(true);
    expect(h.errors.at(-1)).toEqual(expect.any(String));
    expect(h.controller.model.items).toHaveLength(0);
  });

  it("a stream that closes a window it never began is read again, not left open", () => {
    const h = createHarness();
    void h.controller.load();
    const first = h.stream.reads[0]!;
    first.handlers.onDone?.("w9");
    expect(first.closed).toBe(true);
    expect(h.stream.reads).toHaveLength(2);
  });

  it("a live copy of a history record that came folded is dropped as a duplicate, not drawn twice", async () => {
    const h = createHarness();
    const p = h.controller.load();
    const thought = at(thinkingMessage("weighing it ".repeat(4_000)), "2026-07-05T00:00:01.000Z");
    // The live copy, whole, arrived while the window was read; the window's copy is folded.
    h.controller.handleRecord(thought, "e1-2");
    h.controller.handleServer(idle);
    const source = { agentId: "a1", sessionId: "s1", fileIndex: 1, ordinal: 1 };
    const folded = elideHistoryRecord(thought, source).record;
    h.resolveLoad(
      [HISTORY_TASK[0]!, folded, ...HISTORY_TASK.slice(1)],
      undefined,
      null,
      pageInfo(),
    );
    await p;
    expect(h.controller.model.items.filter((i) => i.kind === "thinking")).toHaveLength(1);
  });

  it("Retry now opens the window read again while the server waits for the machine", () => {
    const h = createHarness();
    void h.controller.load();
    const first = h.stream.reads[0]!;
    h.stream.progress(
      first,
      progressOf("window", 0, 0, { reason: "retrying", attempt: 2, nextAt: 1_006_000 }),
    );
    h.controller.retryNow();
    expect(first.closed).toBe(true);
    expect(h.stream.reads).toHaveLength(2);
    expect(h.stream.reads[1]!.query).toEqual(first.query);
  });

  /** A window whose one tool output came folded: a preview and the entry naming the whole. */
  async function foldedCard(whole: string): Promise<{ h: Harness; card: ToolCallItem }> {
    const h = createHarness();
    const p = h.controller.load();
    h.controller.handleServer(idle);
    const call = at(
      toolCall({ name: "exec_command", arguments: '{"cmd":"cat big.log"}', toolCallId: "c1" }),
      "2026-07-05T00:00:01.000Z",
    );
    const output = at(
      toolCallOutput({ output: "headtail", toolCallId: "c1", status: "completed" }),
      "2026-07-05T00:00:02.000Z",
    );
    const elided = [
      { path: "payload.output", bytes: whole.length, lines: 1, head: 4, ref: "ref-out" },
    ];
    const folded: HistoryMessage = { ...output, elided };
    h.resolveLoad([HISTORY_TASK[0]!, call, folded], undefined, null, pageInfo());
    await p;
    return { h, card: findToolCard(h.controller.model, [], "c1")! };
  }

  it("unfolding an item fetches its folded value by its ref and shows the whole once it has arrived", async () => {
    const whole = "the whole output ".repeat(2_000);
    const { h, card } = await foldedCard(whole);
    expect(card.output).toBe("headtail");
    h.controller.loadBodies(card);
    h.controller.loadBodies(card); // a second unfold while fetching asks nothing more
    expect(h.stream.bodies.map((b) => b.ref)).toEqual(["ref-out"]);
    const body = h.stream.bodies[0]!;
    body.handlers.onProgress?.(progressOf("window", 8_000, whole.length));
    expect(card.bodyLoad).toEqual({ doneBytes: 8_000, totalBytes: whole.length, error: null });
    body.handlers.onRecords?.({ windowId: "b", offset: 0, text: whole.slice(0, 100) }, "part");
    body.handlers.onRecords?.({ windowId: "b", offset: 100, text: whole.slice(100) }, "part");
    body.handlers.onDone?.(null);
    expect(card.output).toBe(whole);
    expect(card.bodyLoad).toBeUndefined();
    expect(card.elidedOutput).toBeUndefined();
  });

  it("a failed fetch of a folded value is said on the item and starts over on the next unfold", async () => {
    const { h, card } = await foldedCard("x".repeat(20_000));
    h.controller.loadBodies(card);
    h.stream.bodies[0]!.handlers.onError({ code: "test_failure", message: "gone" });
    expect(card.bodyLoad?.error).toBe("gone");
    expect(card.output).toBe("headtail");
    h.controller.loadBodies(card);
    expect(h.stream.bodies).toHaveLength(2);
    expect(card.bodyLoad?.error).toBeNull();
  });
});
