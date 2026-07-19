/**
 * OmniMessage stream → render view-model reducer. A
 * pure logic module, no React dependency: takes in an ordered sequence of
 * OmniMessage (history's complete messages + real-time partial/complete/
 * event), and produces a `ChatItem[]` view model (updated in place, with the caller triggering the re-render).
 *
 * Key points:
 *   - Fragment tracking: partial_text / partial_thinking are tracked by "the
 *     currently open fragment"; partial_tool_call / partial_tool_call_output
 *     are attributed to a tool card by tool_call_id. start opens it, delta
 *     accumulates, stop closes it; the subsequent complete message
 *     **replaces** the fragment's content (guaranteeing consistency;
 *     with no open fragment — mid-stream join — it's appended directly); an
 *     orphan delta (no start seen) is ignored, converging once the complete message arrives.
 *   - origin routing: messages carrying an origin go into a SubagentCard;
 *     when a sub-session's session_meta arrives, it binds to "the most
 *     recent allowed (decision=allow) and not-yet-complete run_subagent tool
 *     card that hasn't been bound to an origin yet", creating a standalone
 *     SubagentCard if none is found; inside the card, the same reducer
 *     recurses (with the first origin hop stripped). Sub-session
 *     token_usage counts toward this level's stats (same convention as the CLI).
 *   - Events: approval_decision annotates the corresponding tool card
 *     (labeled "manual" if clicked on this end, "automatic" otherwise);
 *     abort → an interruption marker item; request_end ending in
 *     timeout/malformed → a retry-hint item (the engine discards that
 *     attempt and resends the original input; the next request_begin marks the hint as resent, and an
 *     arriving abort marks it as retries exhausted); other request_begin/end
 *     events aren't rendered (Request duration is covered by Trace
 *     performance analysis); compaction_begin/end → a banner item;
 *     token_usage → fed into stats (task-stats.ts).
 *   - Compaction-internal messages (history rebuild): model_msg within a
 *     compaction_begin↔end range (the compaction prompt and summary output)
 *     are never rendered and never counted toward Task segmentation — aligned
 *     with the live stream (which only pushes the event pair + token_usage);
 *     user text prefixed with `<context_summary>` is a compaction-summary
 *     injection, treated as internal input (not rendered, doesn't start a new Task).
 *   - Task segmentation: a complete text/image message on the main
 *     session's user side starts a new Task; a Task ends when the live
 *     stream receives task_state:idle (notifyTaskIdle), or — during history
 *     rebuild — when the next Task starts / the stream ends
 *     (finalizeHistory). Live finalization takes the duration as the larger
 *     of the local-clock delta and the message-timestamp span (the local
 *     clock only covers the time since a mid-stream join). A stats row is only added if token_usage occurred during the Task.
 *   - Overlap-dedup helpers: buildDedupIndex/isDuplicate
 *     judge duplicates by exact match of the envelope JSON; when a complete
 *     message hits the dedup check, discardFragmentFor also discards the corresponding in-flight fragment.
 * Docs: /docs/omni-message § "The streaming discipline".
 */
import { isEventMessage, isPartialPayload } from "@prismshadow/penguin-core/omnimessage";
import type {
  ApprovalDecision,
  CompactionMode,
  CompactionReason,
  CompleteModelPayload,
  EventPayload,
  OmniMessage,
  PartialModelPayload,
  StopReason,
  TokenUsagePayload,
} from "@prismshadow/penguin-core/omnimessage";
import {
  addLlmDuration,
  beginCompaction,
  commitPendingCompaction,
  createTaskStatsTracker,
  endCompaction,
  endTask,
  resetTaskCounters,
  trackMainUsage,
  trackSubagentUsage,
} from "./task-stats";
import type { TaskStats, TaskStatsTracker } from "./task-stats";

// ---------------------------------------------------------------------------
// View model types
// ---------------------------------------------------------------------------

/** Source of an approval decision: clicked on this end (manual) / other (automatic judgment or submitted by another end). */
export type DecisionSource = "manual" | "remote";

export interface UserTextItem {
  kind: "user_text";
  id: number;
  text: string;
  /** Message timestamp (milliseconds): shown on footer hover. History and real time share the same source — this message's own timestamp. */
  atMs?: number;
}

export interface UserImageItem {
  kind: "user_image";
  id: number;
  imageUrl: string;
  /** Message timestamp (milliseconds): shown on footer hover. */
  atMs?: number;
}

export interface AssistantTextItem {
  kind: "assistant_text";
  id: number;
  text: string;
  /** The streamed fragment is still accumulating. */
  streaming: boolean;
  stopReason?: StopReason;
  /**
   * Message timestamp (milliseconds): shown on footer hover. During
   * streaming it's a placeholder using the partial start's timestamp;
   * once the complete message arrives, it switches to that message's own
   * timestamp — the same convention as Trace (which records the **completion** time).
   */
  atMs?: number;
}

export interface ThinkingItem {
  kind: "thinking";
  id: number;
  thinking: string;
  streaming: boolean;
  stopReason?: StopReason;
  /** Start timestamp in milliseconds (the partial start's message time; approximated by the previous message's time when history has no fragments). */
  startedAtMs?: number;
  /** Thinking duration (settled when the complete message arrives: message time - start time). */
  durationMs?: number;
}

export interface ToolCallItem {
  kind: "tool_call";
  id: number;
  toolCallId: string;
  name: string;
  /** Tool argument JSON (accumulated via streamed deltas, replaced once the complete message arrives). */
  argumentsText: string;
  callStreaming: boolean;
  /** A complete tool_call message has been received (all streamed copies after this are ignored). */
  callComplete: boolean;
  callStopReason?: StopReason;
  /** Tool output (appended via streaming, replaced once the complete message arrives; truncation/timeout/interruption markers are already in the text). */
  output: string;
  /** Images carried by the tool output (an array of data URLs; a streamed delta carries the whole array at once, and the complete message converges it again). */
  images?: string[];
  outputStreaming: boolean;
  outputComplete: boolean;
  outputStopReason?: StopReason;
  /** Approval decision (annotated by the approval_decision event). */
  decision?: ApprovalDecision;
  decisionSource?: DecisionSource;
  /** run_subagent: the bound sub-session stream (nested model). */
  subagent?: StreamModel;
  subagentSessionId?: string;
  /** Tool execution start (the message time when the tool_call closed; same convention as Trace analysis). */
  callStartedAtMs?: number;
  /** Approval-granted moment (the approval_decision message time): execution timing starts from here, deducting the approval wait. */
  approvalAtMs?: number;
  /** This card's approval wait has already been counted toward its owning Request (see noteApprovalWait): whichever of the two timestamps arrives later triggers it, guarding against double-counting. */
  approvalWaitCounted?: boolean;
  /**
   * Argument generation start (the partial_tool_call start's message time):
   * the rolling timing baseline during streamed argument generation.
   * Approximated by the previous message's time when history rebuild has no fragments (same convention as thinking).
   */
  argStartedAtMs?: number;
  /** Total tool duration (settled when the tool_call_output complete message arrives) = the argument-generation segment + the execution segment, excluding the approval wait (see settleToolDuration). */
  durationMs?: number;
}

/** A standalone sub-session card for when no run_subagent tool card can be bound. */
export interface SubagentItem {
  kind: "subagent";
  id: number;
  sessionId: string;
  model: StreamModel;
}

export interface AbortItem {
  kind: "abort";
  id: number;
  reason?: string;
}

/** An LLM Request ending in timeout/malformed → the engine retries carrying the content already produced. */
export interface ReconnectItem {
  kind: "reconnect";
  id: number;
  /** Trigger reason: timeout (timed out / disconnected) or malformed (an incomplete or unparseable response). */
  status: "timeout" | "malformed";
  /** Which retry attempt this is (increments on consecutive failures within the same round; resets to 1 after a request finishes normally). */
  attempt: number;
  /** The retry request has been sent (set true by the next request_begin). */
  retrying: boolean;
  /** Retries exhausted (set true when an abort event arrives; the subsequent interruption marker item gives the reason). */
  gaveUp?: boolean;
}

export interface CompactionItem {
  kind: "compaction";
  id: number;
  reason: CompactionReason;
  mode: CompactionMode;
  /** True between begin and end (renders a "compaction in progress" banner). */
  running: boolean;
  status?: StopReason;
}

export interface TaskStatsItem {
  kind: "task_stats";
  id: number;
  /**
   * This Task's stats; `null` = no token_usage occurred this round (e.g. the
   * reply was interrupted mid-way), so there's nothing to show. This item
   * is still produced in that case — it also serves as that reply's
   * **footer** (timestamp + copy); not producing it would leave an interrupted reply without a timestamp or copy button.
   */
  stats: TaskStats | null;
  /** This Task's assistant text (the copy button's target); an empty string when there's no text. */
  assistantText: string;
  /**
   * Timestamp (milliseconds) of this Task's last assistant text. The stats
   * row sits right below the AI reply and itself doubles as that reply's
   * footer — the timestamp and copy both belong to it, and the assistant
   * message is never rendered with its own separate footer (otherwise two copy buttons would appear in the same spot).
   */
  atMs?: number;
}

export type ChatItem =
  | UserTextItem
  | UserImageItem
  | AssistantTextItem
  | ThinkingItem
  | ToolCallItem
  | SubagentItem
  | AbortItem
  | ReconnectItem
  | CompactionItem
  | TaskStatsItem;

// ---------------------------------------------------------------------------
// Model state
// ---------------------------------------------------------------------------

export interface StreamModel {
  items: ChatItem[];
  /** A nested sub-session model (produces no stats row; its stats count toward the parent). */
  nested: boolean;
  stats: TaskStatsTracker;
  /** The currently open text/thinking fragment (opened by start, closed by stop). */
  openText: AssistantTextItem | null;
  openThinking: ThinkingItem | null;
  /** A fragment that has stopped and is waiting to be replaced by the complete message. */
  pendingText: AssistantTextItem | null;
  pendingThinking: ThinkingItem | null;
  /** tool_call_id → tool card (shared by both fragment attribution and complete-message replacement). */
  toolCards: Map<string, ToolCallItem>;
  /** Direct child Session id → nested model. */
  subagents: Map<string, StreamModel>;
  /** toolCallIds whose approval was clicked on this end (shares the reference with nested models, labeled "manual"). */
  localDecisions: Set<string>;
  /** Approval decisions that arrived before their tool card (backfilled when the card is created). */
  pendingDecisions: Map<string, ApprovalDecision>;
  /** Approval timestamps that arrived before their tool card (backfilled into approvalAtMs when the card is created, used to deduct the approval duration). */
  pendingDecisionTs: Map<string, number>;
  /** Timestamp of the most recent message (used to approximate the start time when history's thinking has no fragments). */
  lastTsMs: number;
  /**
   * The millisecond time of the main session's currently unclosed Request's
   * request_begin (used for output TPS timing): when request_end arrives, it
   * pairs with this to compute the wall-clock duration added to this Task's
   * LLM time; compaction requests aren't timed; a later begin overrides an unclosed one.
   */
  openRequestBeginMs: number | null;
  /**
   * Total human approval wait time (milliseconds) within the currently
   * unclosed Request: deducted from the wall-clock duration at request_end,
   * so only the time the LLM is actually generating counts toward the
   * output TPS denominator. Core does `await approve(tc)` inside the
   * streaming loop — if approval doesn't return, the next chunk isn't
   * consumed and request_end isn't emitted either, so the whole human wait
   * sits sandwiched between request_begin and request_end; without
   * deducting it, "5s of generation + 55s of approval wait" would render
   * 100 tok/s as 8 tok/s. Tool **execution** isn't included here (core
   * dispatches it via `void executeOne`, which doesn't block the streaming loop — execution happens between two Requests).
   */
  openApprovalWaitMs: number;
  /** Consecutive reconnect-failure count (incremented when request_end is timeout/malformed, reset to zero on any other terminal status). */
  reconnectRun: number;
  /** Task segmentation state. */
  taskOpen: boolean;
  taskStartLocalMs: number;
  taskFirstTsMs: number;
  /**
   * The latest timestamp seen among this round's messages, used only as a
   * **fallback for the round's end**: only used for a degenerate round that
   * has no request_end at all (interrupted before its first Request even
   * ran). The normal round-end is taken from taskLastReqEndMs.
   */
  taskLastTsMs: number;
  /**
   * The timestamp of this round's last **non-compaction** request_end — this
   * is the true round end, and this round's duration = it − the first
   * message. A round's real work is done once its last Request finishes:
   *   - Automatic compaction **mid-round** (the engine keeps running with a
   *     carry-over after compacting, so a normal Request follows the
   *     compaction) sits **within** the span and is naturally counted into
   *     the round's duration — which is correct, since compaction did occupy this round's wall-clock time;
   *   - Compaction **after the round ends** (finalization's automatic
   *     compaction / manual /compact), the next round's injected
   *     `<context_summary>`, and the session_meta rewritten after a file
   *     rotation all come **after** it, and are naturally excluded from the round.
   * So no compaction wall-clock addition/subtraction is needed at all —
   * just take the span directly (history rebuild and live share the same
   * convention, consistent before and after a refresh).
   * null = this round has no request_end yet (a degenerate round, falls back to taskLastTsMs).
   */
  taskLastReqEndMs: number | null;
  nextItemId: number;
}

function newModel(nested: boolean, localDecisions: Set<string>): StreamModel {
  return {
    items: [],
    nested,
    stats: createTaskStatsTracker(),
    openText: null,
    openThinking: null,
    pendingText: null,
    pendingThinking: null,
    toolCards: new Map(),
    subagents: new Map(),
    localDecisions,
    pendingDecisions: new Map(),
    pendingDecisionTs: new Map(),
    lastTsMs: 0,
    openRequestBeginMs: null,
    openApprovalWaitMs: 0,
    reconnectRun: 0,
    taskOpen: false,
    taskStartLocalMs: 0,
    taskFirstTsMs: 0,
    taskLastTsMs: 0,
    taskLastReqEndMs: null,
    nextItemId: 1,
  };
}

/** Create the main-session model; localDecisions can inject a shared set (persisting across models when a resync rebuild swaps in a new one). */
export function createStreamModel(localDecisions: Set<string> = new Set()): StreamModel {
  return newModel(false, localDecisions);
}

function nextId(model: StreamModel): number {
  return model.nextItemId++;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/** Feed in one OmniMessage in order (history or live); nowMs is used for the Task's live timing (injectable for tests). */
export function pushMessage(
  model: StreamModel,
  msg: OmniMessage,
  nowMs: number = Date.now(),
): void {
  if (msg.origin && msg.origin.length > 0) {
    routeNested(model, msg, nowMs);
    return;
  }
  if (msg.type === "model_msg") {
    // Internal messages within a compaction range (between begin and end)
    // (the compaction prompt, summary output): never rendered, never
    // counted toward Task segmentation — aligned with the live stream
    // (which only pushes the event pair and token_usage). Only encountered during history rebuild.
    if (model.stats.compactionActive) {
      touchTask(model, msg.timestamp);
      advanceLastTs(model, msg.timestamp);
      return;
    }
    if (isPartialPayload(msg.payload)) {
      touchTask(model, msg.timestamp);
      handlePartial(model, msg.payload, tsOf(msg.timestamp));
      // lastTsMs only advances from complete messages/events: an orphan
      // delta during a mid-stream join shouldn't push "the previous
      // message's time" up to just before a complete thinking message, or the approximated historical duration would collapse to ~0ms.
      return;
    }
    handleComplete(model, msg.payload as CompleteModelPayload, msg.timestamp, nowMs);
    advanceLastTs(model, msg.timestamp);
    return;
  }
  if (isEventMessage(msg)) {
    touchTask(model, msg.timestamp);
    handleEvent(model, msg.payload as EventPayload, tsOf(msg.timestamp));
    advanceLastTs(model, msg.timestamp);
    return;
  }
  // session_meta (main session): not rendered.
}

/** ISO timestamp → milliseconds (returns undefined if invalid). */
function tsOf(timestamp: string): number | undefined {
  const ms = Date.parse(timestamp);
  return Number.isFinite(ms) ? ms : undefined;
}

function advanceLastTs(model: StreamModel, timestamp: string): void {
  const ms = Date.parse(timestamp);
  if (Number.isFinite(ms)) model.lastTsMs = ms;
}

export function pushMessages(
  model: StreamModel,
  messages: OmniMessage[],
  nowMs: number = Date.now(),
): void {
  for (const msg of messages) pushMessage(model, msg, nowMs);
}

/** The live stream received task_state:idle: finalize the current Task using the local clock. */
export function notifyTaskIdle(model: StreamModel, nowMs: number = Date.now()): void {
  finalizeOpenTask(model, "live", nowMs);
}

/** History rebuild is complete (end of stream): finalize the last Task using message timestamps. */
export function finalizeHistory(model: StreamModel): void {
  finalizeOpenTask(model, "history");
}

/** Register an approval clicked on this end (so the subsequent approval_decision event is labeled "manual"). */
export function registerLocalDecision(model: StreamModel, toolCallId: string): void {
  model.localDecisions.add(toolCallId);
}

/**
 * Pending-approvals table key: `origin.join("/") + " " + toolCallId` (empty
 * origin for the main session). A parent/child session's tool_call_id can
 * collide, so the origin chain must be included to distinguish them and
 * avoid lighting up the approval button on the wrong tool card.
 */
export function approvalKey(origin: readonly string[] | undefined, toolCallId: string): string {
  return `${origin?.join("/") ?? ""} ${toolCallId}`;
}

/** Locate a tool card in a nested model (at any depth) by its origin chain; returns null if there's no matching card. */
export function findToolCard(
  model: StreamModel,
  origin: readonly string[] | undefined,
  toolCallId: string,
): ToolCallItem | null {
  let cur: StreamModel | undefined = model;
  for (const hop of origin ?? []) {
    cur = cur.subagents.get(hop);
    if (!cur) return null;
  }
  return cur.toolCards.get(toolCallId) ?? null;
}

// ---------------------------------------------------------------------------
// Task segmentation
// ---------------------------------------------------------------------------

/**
 * Advance this round's "latest timestamp seen among its messages" — used
 * only as a **fallback for the round's end** (see taskLastReqEndMs). The
 * normal round-end is set by request_end; this only guarantees a usable
 * upper bound for a degenerate round with no request_end at all
 * (interrupted before its first Request even ran). Compaction forms its
 * own round, and messages within its range don't belong to this round, so this isn't advanced for them.
 */
function touchTask(model: StreamModel, timestamp: string): void {
  if (!model.taskOpen) return;
  if (model.stats.compactionActive) return;
  const ts = Date.parse(timestamp);
  if (!Number.isFinite(ts) || ts <= model.taskLastTsMs) return;
  model.taskLastTsMs = ts;
}

function startTask(model: StreamModel, timestamp: string, nowMs: number): void {
  // The previous Task is finalized by "the next Task starting" (the history-rebuild convention).
  finalizeOpenTask(model, "history");
  // Finalize any retry state left over from the previous Task: when the
  // server dies during a backoff window, the Trace's tail is
  // request_end(timeout) with no abort, and history rebuild would leave a
  // dangling "retrying…" — the new Task's first request_begin isn't its
  // retry, so mark it gaveUp and reset the consecutive-failure count (the new Task's failures count from 1 again).
  const waiting = findLastWaitingReconnect(model);
  if (waiting) waiting.gaveUp = true;
  model.reconnectRun = 0;
  // Any unclosed Request start / approval wait left over from the previous Task isn't carried into this Task's LLM timing.
  model.openRequestBeginMs = null;
  model.openApprovalWaitMs = 0;
  model.taskOpen = true;
  model.taskStartLocalMs = nowMs;
  const ts = Date.parse(timestamp);
  model.taskFirstTsMs = Number.isFinite(ts) ? ts : nowMs;
  model.taskLastTsMs = model.taskFirstTsMs;
  model.taskLastReqEndMs = null;
  // Usage outside this Task's boundary (e.g. a manual compaction) shouldn't be mistakenly counted into this Task's delta.
  resetTaskCounters(model.stats);
}

function finalizeOpenTask(model: StreamModel, mode: "history" | "live", nowMs?: number): void {
  if (!model.taskOpen) return;
  model.taskOpen = false;
  // No more tool output will arrive once a Task is finalized: close cards still "executing" and stop their LiveDuration.
  closeExecutingToolCards(model);
  // This round's duration = this round's last non-compaction request_end −
  // the first message. The round's end is exactly the last Request's
  // finish: compaction **mid-round** sits within the span and is naturally
  // counted in (which is correct — it did occupy this round's wall-clock
  // time), while compaction **after the round ends** sits outside the span
  // and is naturally excluded — no compaction wall-clock addition/subtraction
  // is needed at all, and history rebuild and live share the same
  // convention, consistent before and after a refresh (see taskLastReqEndMs).
  const endMs = model.taskLastReqEndMs ?? model.taskLastTsMs;
  const tsElapsed = Math.max(0, endMs - model.taskFirstTsMs);
  // Only a degenerate round (no request_end at all for the whole round,
  // e.g. interrupted before its first Request even ran) falls back to the
  // local clock: during a mid-stream join / resync rebuild, the local clock
  // only covers the time since joining, so it's compared against the
  // message span and the larger is taken to avoid underestimating. When
  // there is a request_end, it's the accurate round-end and is used
  // directly (not compared against the local clock, to avoid folding in noise like idle-detection latency).
  let elapsed: number;
  if (model.taskLastReqEndMs !== null) {
    elapsed = tsElapsed;
  } else if (mode === "live") {
    elapsed = Math.max((nowMs ?? Date.now()) - model.taskStartLocalMs, tsElapsed);
  } else {
    elapsed = tsElapsed;
  }
  const stats = endTask(model.stats, elapsed);
  if (model.nested) return;
  const reply = collectTaskAssistant(model);
  // No token_usage (the reply was interrupted mid-way) → there are no stats
  // to show, but as long as this round produced any text, there still needs
  // to be a footer: the timestamp and copy are both rendered by the stats
  // row, so not producing it here would leave that reply with no footer at
  // all. Only skip when both are absent — then there's truly nothing to do.
  if (stats === null && reply.text === "") return;
  const statsItem: TaskStatsItem = {
    kind: "task_stats",
    id: nextId(model),
    stats,
    assistantText: reply.text,
    ...(reply.atMs !== undefined ? { atMs: reply.atMs } : {}),
  };
  // The stats row is inserted **before this trailing run of compaction
  // banners**: an automatic compaction triggered while finalizing a round
  // would otherwise sandwich its banner between the reply and the stats row
  // (items: assistant_text → compaction → task_stats), leaving the stats
  // row underneath the banner, reading as if it were "the compaction's
  // stats" when it's actually reporting this round's conversation.
  // Compaction is housekeeping outside this round, so it belongs after this round's ledger, not before it.
  let at = model.items.length;
  while (at > 0 && model.items[at - 1]!.kind === "compaction") at--;
  model.items.splice(at, 0, statsItem);
}

/**
 * Collect this Task's assistant text (walking backward from the end until
 * the previous task_stats, concatenating assistant_text), and give the
 * timestamp of the **last** assistant text item — the stats row is this
 * round's reply's footer, and this is the timestamp it shows.
 */
function collectTaskAssistant(model: StreamModel): { text: string; atMs?: number } {
  const parts: string[] = [];
  let atMs: number | undefined;
  for (let i = model.items.length - 1; i >= 0; i--) {
    const it = model.items[i]!;
    if (it.kind === "task_stats") break;
    if (it.kind === "assistant_text" && it.text.trim()) {
      parts.push(it.text);
      if (atMs === undefined) atMs = it.atMs; // walking backward: the first hit is the last one
    }
  }
  return { text: parts.reverse().join("\n\n"), ...(atMs !== undefined ? { atMs } : {}) };
}

// ---------------------------------------------------------------------------
// Streamed fragments
// ---------------------------------------------------------------------------

function handlePartial(model: StreamModel, p: PartialModelPayload, tsMs?: number): void {
  switch (p.type) {
    case "partial_text": {
      if (p.event_type === "start") {
        // start reopens the fragment; a stale pending that never got replaced keeps its streamed content and stops waiting to be replaced.
        model.pendingText = null;
        const item: AssistantTextItem = {
          kind: "assistant_text",
          id: nextId(model),
          text: p.text ?? "",
          streaming: true,
          ...(tsMs !== undefined ? { atMs: tsMs } : {}),
        };
        model.openText = item;
        model.items.push(item);
        return;
      }
      const open = model.openText;
      if (!open) return; // orphan delta/stop: ignored, converging once the complete message arrives
      if (p.text) open.text += p.text;
      if (p.event_type === "stop") {
        open.streaming = false;
        if (p.stop_reason !== undefined) open.stopReason = p.stop_reason;
        model.pendingText = open;
        model.openText = null;
      }
      return;
    }
    case "partial_thinking": {
      if (p.event_type === "start") {
        model.pendingThinking = null;
        const item: ThinkingItem = {
          kind: "thinking",
          id: nextId(model),
          thinking: p.thinking ?? "",
          streaming: true,
        };
        if (tsMs !== undefined) item.startedAtMs = tsMs;
        model.openThinking = item;
        model.items.push(item);
        return;
      }
      const open = model.openThinking;
      if (!open) return; // orphan, ignored
      if (p.thinking) open.thinking += p.thinking;
      if (p.event_type === "stop") {
        open.streaming = false;
        if (p.stop_reason !== undefined) open.stopReason = p.stop_reason;
        settleThinkingDuration(open, tsMs);
        model.pendingThinking = open;
        model.openThinking = null;
      }
      return;
    }
    case "partial_tool_call": {
      const card = model.toolCards.get(p.tool_call_id);
      // The complete message already arrived (history / dedup hit): the whole streamed copy is ignored.
      if (card?.callComplete) return;
      if (p.event_type === "start") {
        if (card) {
          // Duplicate start (out-of-order): reset the argument buffer.
          card.name = p.name || card.name;
          card.argumentsText = p.arguments ?? "";
          card.callStreaming = true;
          if (tsMs !== undefined && card.argStartedAtMs === undefined) card.argStartedAtMs = tsMs;
          return;
        }
        const created = createToolCard(model, {
          toolCallId: p.tool_call_id,
          name: p.name,
          argumentsText: p.arguments ?? "",
          callStreaming: true,
        });
        if (tsMs !== undefined) created.argStartedAtMs = tsMs;
        return;
      }
      if (!card) return; // orphan, ignored
      if (p.name && !card.name) card.name = p.name;
      if (p.arguments) card.argumentsText += p.arguments;
      if (p.event_type === "stop") {
        card.callStreaming = false;
        if (p.stop_reason !== undefined) card.callStopReason = p.stop_reason;
        // Execution start = the call's closing timestamp (same convention as Trace analysis: tool_call → tool_call_output).
        if (tsMs !== undefined) card.callStartedAtMs = tsMs;
      }
      return;
    }
    case "partial_tool_call_output": {
      const card = model.toolCards.get(p.tool_call_id);
      // No matching call card (orphan) or output already complete: ignored, converging once the complete message arrives.
      if (!card || card.outputComplete) return;
      if (p.event_type === "start") {
        card.outputStreaming = true;
        if (p.output) card.output += p.output;
        return;
      }
      if (!card.outputStreaming) return; // orphan delta/stop
      if (p.output) card.output += p.output;
      // Image delta: a single delta carries the whole array at once (the complete message converges it again, overwriting with the same value).
      if (p.images && p.images.length > 0) card.images = p.images;
      if (p.event_type === "stop") {
        card.outputStreaming = false;
        if (p.stop_reason !== undefined) card.outputStopReason = p.stop_reason;
        settleToolDuration(card, tsMs);
      }
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Complete messages
// ---------------------------------------------------------------------------

function handleComplete(
  model: StreamModel,
  p: CompleteModelPayload,
  timestamp: string,
  nowMs: number,
): void {
  switch (p.type) {
    case "text": {
      if (p.role === "user") {
        // Compaction-summary injection (`<context_summary>` prefix, an
        // internal input in the new context file): not rendered as a user bubble, doesn't start a new Task.
        if (p.text.startsWith("<context_summary>")) {
          touchTask(model, timestamp);
          return;
        }
        // A complete text message on the main session's user side: starts a new Task.
        startTask(model, timestamp, nowMs);
        const atMs = tsOf(timestamp);
        model.items.push({
          kind: "user_text",
          id: nextId(model),
          text: p.text,
          ...(atMs !== undefined ? { atMs } : {}),
        });
        return;
      }
      touchTask(model, timestamp);
      // The complete message usually follows right after a fragment's stop: prefer replacing an already-closed pending fragment, then a still-open one.
      const target = model.pendingText ?? model.openText;
      if (target) {
        // The complete message replaces the fragment's content (this guarantees consistency).
        target.text = p.text;
        target.streaming = false;
        const doneMs = tsOf(timestamp);
        if (doneMs !== undefined) target.atMs = doneMs; // the completion timestamp overrides the start placeholder
        if (p.stop_reason !== undefined) target.stopReason = p.stop_reason;
        if (target === model.openText) model.openText = null;
        model.pendingText = null;
        return;
      }
      // No open fragment (history / mid-stream join): append directly.
      const doneMs = tsOf(timestamp);
      const item: AssistantTextItem = {
        kind: "assistant_text",
        id: nextId(model),
        text: p.text,
        streaming: false,
        ...(doneMs !== undefined ? { atMs: doneMs } : {}),
      };
      if (p.stop_reason !== undefined) item.stopReason = p.stop_reason;
      model.items.push(item);
      return;
    }
    case "image_url": {
      startTask(model, timestamp, nowMs);
      const imgMs = tsOf(timestamp);
      model.items.push({
        kind: "user_image",
        id: nextId(model),
        imageUrl: p.image_url,
        ...(imgMs !== undefined ? { atMs: imgMs } : {}),
      });
      return;
    }
    case "thinking": {
      touchTask(model, timestamp);
      const tsMs = tsOf(timestamp);
      const target = model.pendingThinking ?? model.openThinking;
      if (target) {
        target.thinking = p.thinking;
        target.streaming = false;
        if (p.stop_reason !== undefined) target.stopReason = p.stop_reason;
        settleThinkingDuration(target, tsMs);
        if (target === model.openThinking) model.openThinking = null;
        model.pendingThinking = null;
        return;
      }
      const item: ThinkingItem = {
        kind: "thinking",
        id: nextId(model),
        thinking: p.thinking,
        streaming: false,
      };
      if (p.stop_reason !== undefined) item.stopReason = p.stop_reason;
      // History rebuild (no fragment): approximate the thinking start with the previous message's time.
      if (model.lastTsMs > 0) item.startedAtMs = model.lastTsMs;
      settleThinkingDuration(item, tsMs);
      model.items.push(item);
      return;
    }
    case "tool_call": {
      touchTask(model, timestamp);
      const tsMs = tsOf(timestamp);
      // A card that's already a complete call receives another complete tool_call with the same id:
      // not a duplicate delivery (duplicates were already caught by dedup) but **another** call reusing
      // the id — as seen in legacy Traces from a name-as-id provider (e.g. Gemini using the function
      // name as tool_call_id). Take the create branch and start a new card (createToolCard repoints the
      // Map to the newest card, so later output/approval attribute by id to the newest); never overwrite the old card.
      const existing = model.toolCards.get(p.tool_call_id);
      const card = existing?.callComplete ? undefined : existing;
      if (card) {
        card.name = p.name;
        card.argumentsText = p.arguments;
        card.callStreaming = false;
        card.callComplete = true;
        if (p.stop_reason !== undefined) card.callStopReason = p.stop_reason;
        if (tsMs !== undefined) card.callStartedAtMs = tsMs;
        noteApprovalWait(model, card); // Approval arrived first (mid-stream join): only here do both timestamps come together
        settleUndispatchedCall(card);
        return;
      }
      if (existing && !existing.outputComplete) {
        // If the replaced old card is still "executing" (output not closed): the Map is about to
        // repoint to the new card, so the old card will never get output — close it as aborted to stop
        // the running timer (same behavior as closeExecutingToolCards).
        existing.outputComplete = true;
        existing.outputStreaming = false;
        existing.outputStopReason ??= "aborted";
      }
      const created = createToolCard(model, {
        toolCallId: p.tool_call_id,
        name: p.name,
        argumentsText: p.arguments,
        callStreaming: false,
      });
      created.callComplete = true;
      if (p.stop_reason !== undefined) created.callStopReason = p.stop_reason;
      if (tsMs !== undefined) created.callStartedAtMs = tsMs;
      noteApprovalWait(model, created); // createToolCard may have already backfilled a pending approval timestamp
      // History rebuild (no partial_tool_call start): approximate "argument
      // generation started" with the previous message's time, same
      // convention as thinking. Otherwise the tool duration would lose its
      // argument-generation segment (often the bulk of it) after a refresh, for no reason.
      if (model.lastTsMs > 0) created.argStartedAtMs = model.lastTsMs;
      settleUndispatchedCall(created);
      return;
    }
    case "tool_call_output": {
      touchTask(model, timestamp);
      let card = model.toolCards.get(p.tool_call_id);
      if (!card) {
        // Mid-stream join: create a card if the call card is missing (name unknown, UI falls back to showing tool_call_id).
        card = createToolCard(model, {
          toolCallId: p.tool_call_id,
          name: "",
          argumentsText: "",
          callStreaming: false,
        });
      }
      card.output = p.output;
      // The complete message converges the images (the streamed delta already carried them once; overwrites with the same value; also serves as a fallback for a mid-stream join).
      if (p.images && p.images.length > 0) card.images = p.images;
      card.outputStreaming = false;
      card.outputComplete = true;
      if (p.stop_reason !== undefined) card.outputStopReason = p.stop_reason;
      settleToolDuration(card, tsOf(timestamp));
      return;
    }
    // inline_data / inline_thinking: same convention as the CLI's history rendering — not shown for now.
    case "inline_data":
    case "inline_thinking":
      touchTask(model, timestamp);
      return;
  }
}

/**
 * Close tool cards still "executing" (call complete, output not yet
 * arrived): after an interruption or Task finalization, these cards will
 * never get a tool_call_output, so mark output complete to stop the view
 * layer's rolling timer; the duration stays unset and isn't shown. The
 * stop reason is recorded as aborted — these tools **never produced a
 * result**, and leaving it unset would render as a "completed" checkmark,
 * visually indistinguishable from "executed successfully but with empty output".
 * A late-arriving complete tool_call_output (if any) still overrides unconditionally, unaffected by this.
 */
function closeExecutingToolCards(model: StreamModel): void {
  for (const card of model.toolCards.values()) {
    if (card.callComplete && !card.outputComplete) {
      card.outputComplete = true;
      card.outputStreaming = false;
      card.outputStopReason ??= "aborted";
    }
  }
}

/**
 * A tool_call that closed with a non-completed status (produced by a
 * timeout/malformed interrupt closure) was never dispatched for execution
 * and will never get a tool_call_output: settle the card by its closing
 * reason as soon as it arrives, so the execution timer doesn't keep spinning forever.
 */
function settleUndispatchedCall(card: ToolCallItem): void {
  if (!card.callStopReason || card.callStopReason === "completed" || card.outputComplete) return;
  card.outputComplete = true;
  card.outputStreaming = false;
  card.outputStopReason ??= card.callStopReason;
}

/** Settle the thinking duration: end time - start time (skipped if either is missing; negative values clamp to 0). */
function settleThinkingDuration(item: ThinkingItem, endMs: number | undefined): void {
  if (endMs === undefined || item.startedAtMs === undefined) return;
  item.durationMs = Math.max(0, endMs - item.startedAtMs);
}

/**
 * Settle the tool duration = the argument-generation segment + the
 * execution segment (excluding the human approval wait).
 * - Argument-generation segment: callStartedAtMs − argStartedAtMs (tool_call
 *   from generation start to closing);
 * - Execution segment: endMs − the execution start point (preferring the
 *   approval-granted timestamp approvalAtMs, deducting the approval wait;
 *   falling back to the call's closing timestamp callStartedAtMs when there's no approval event).
 * Adding the two gives the tool call's total duration; a later-arriving
 * tool_call_output only fills in the execution segment, never overwriting
 * the already-settled generation segment.
 * Degrades to a pure execution segment when the start point is missing, still never negative.
 */
function settleToolDuration(card: ToolCallItem, endMs: number | undefined): void {
  if (endMs === undefined) return;
  const execStart = card.approvalAtMs ?? card.callStartedAtMs;
  if (execStart === undefined) return;
  const genMs =
    card.argStartedAtMs !== undefined && card.callStartedAtMs !== undefined
      ? Math.max(0, card.callStartedAtMs - card.argStartedAtMs)
      : 0;
  card.durationMs = genMs + Math.max(0, endMs - execStart);
}

/**
 * Add this card's human approval wait (approval_decision timestamp − the
 * tool_call's closing timestamp) into the currently unclosed Request, for
 * request_end to deduct from the wall-clock duration (see StreamModel.openApprovalWaitMs).
 *
 * The normal order is tool_call arriving first, approval_decision later;
 * joining the live stream mid-way can reverse this (the approval lands in
 * pendingDecisions first, backfilled when the card is created). So whichever
 * of the two timestamps arrives later triggers this, with
 * approvalWaitCounted guarding against double-counting. An auto-approved
 * interval is ≈0, so deducting it does no harm.
 */
function noteApprovalWait(model: StreamModel, card: ToolCallItem): void {
  if (card.approvalWaitCounted) return;
  const { callStartedAtMs: call, approvalAtMs: approval } = card;
  if (call === undefined || approval === undefined) return;
  card.approvalWaitCounted = true;
  const wait = approval - call;
  if (wait > 0) model.openApprovalWaitMs += wait;
}

function createToolCard(
  model: StreamModel,
  init: { toolCallId: string; name: string; argumentsText: string; callStreaming: boolean },
): ToolCallItem {
  const item: ToolCallItem = {
    kind: "tool_call",
    id: nextId(model),
    toolCallId: init.toolCallId,
    name: init.name,
    argumentsText: init.argumentsText,
    callStreaming: init.callStreaming,
    callComplete: false,
    output: "",
    outputStreaming: false,
    outputComplete: false,
  };
  // An approval decision that arrived before the card: backfilled at creation time.
  const pending = model.pendingDecisions.get(init.toolCallId);
  if (pending !== undefined) {
    item.decision = pending;
    item.decisionSource = model.localDecisions.has(init.toolCallId) ? "manual" : "remote";
    model.pendingDecisions.delete(init.toolCallId);
    const pendingTs = model.pendingDecisionTs.get(init.toolCallId);
    if (pendingTs !== undefined) {
      item.approvalAtMs = pendingTs;
      model.pendingDecisionTs.delete(init.toolCallId);
    }
  }
  model.toolCards.set(init.toolCallId, item);
  model.items.push(item);
  return item;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function handleEvent(model: StreamModel, p: EventPayload, tsMs?: number): void {
  switch (p.type) {
    case "approval_decision": {
      const card = model.toolCards.get(p.tool_call_id);
      if (card) {
        card.decision = p.decision;
        card.decisionSource = model.localDecisions.has(p.tool_call_id) ? "manual" : "remote";
        // Approval-granted timestamp: execution timing starts from here (deducting the approval wait).
        if (tsMs !== undefined && card.approvalAtMs === undefined) card.approvalAtMs = tsMs;
        noteApprovalWait(model, card); // Normal order: approval arrives later, both timestamps are already available here
      } else {
        model.pendingDecisions.set(p.tool_call_id, p.decision);
        if (tsMs !== undefined) model.pendingDecisionTs.set(p.tool_call_id, tsMs);
      }
      return;
    }
    case "abort": {
      // In-flight tools won't get any more output after an interruption (a
      // placeholder resend goes only to the model, never written to Trace): finalize the executing cards.
      closeExecutingToolCards(model);
      // A reconnect hint waiting to retry: an interruption means retries are
      // exhausted/abandoned, so mark it gaveUp (this interruption marker item gives the reason);
      // the run has ended, so reset the consecutive-failure count.
      const waiting = findLastWaitingReconnect(model);
      if (waiting) waiting.gaveUp = true;
      model.reconnectRun = 0;
      const item: AbortItem = { kind: "abort", id: nextId(model) };
      if (p.reason != null) item.reason = p.reason;
      model.items.push(item);
      return;
    }
    case "token_usage":
      trackMainUsage(model.stats, p);
      return;
    case "compaction_begin": {
      beginCompaction(model.stats);
      model.items.push({
        kind: "compaction",
        id: nextId(model),
        reason: p.reason,
        mode: p.mode,
        running: true,
      });
      return;
    }
    case "compaction_end": {
      // status decides whether context usage is cleared: when not completed, the original context is kept (see endCompaction).
      endCompaction(model.stats, p.status);
      const item = findLastRunningCompaction(model);
      if (item) {
        item.running = false;
        item.status = p.status;
      } else {
        // Mid-stream join (missed the begin): append a completed banner directly.
        const created: CompactionItem = {
          kind: "compaction",
          id: nextId(model),
          reason: p.reason,
          mode: p.mode,
          running: false,
          status: p.status,
        };
        model.items.push(created);
      }
      return;
    }
    case "request_begin": {
      // A retry request was sent: mark the waiting reconnect hint as resent (a no-op when there's no such item before a normal first request).
      const waiting = findLastWaitingReconnect(model);
      if (waiting) waiting.retrying = true;
      // Record this Request's start (for output TPS timing); compaction requests aren't timed.
      if (!model.stats.compactionActive) {
        model.openRequestBeginMs = tsMs ?? null;
        model.openApprovalWaitMs = 0;
      }
      return;
    }
    case "request_end": {
      // timeout/malformed: the engine retries carrying the content already
      // produced, rendering a retry hint (with the attempt number); other
      // terminal statuses aren't rendered (Request duration is covered by Trace performance
      // analysis) and reset the consecutive-failure count. request events
      // within a compaction range (only visible during history rebuild)
      // are neither rendered nor counted — the compaction process only exposes the compaction event pair to the Human.
      if (model.stats.compactionActive) return;
      // Pairs with request_begin to compute this Request's wall-clock
      // duration, deducts the human approval wait, and adds the result to
      // this Task's LLM time (for output TPS) — this duration includes tool
      // argument generation but excludes tool execution (which happens
      // between two Requests) and excludes the human approval wait (see openApprovalWaitMs).
      if (model.openRequestBeginMs !== null && tsMs !== undefined) {
        addLlmDuration(model.stats, tsMs - model.openRequestBeginMs - model.openApprovalWaitMs);
      }
      model.openRequestBeginMs = null;
      model.openApprovalWaitMs = 0;
      // This is now the round's end (so far): update taskLastReqEndMs, with
      // the duration taken as "it − the first message". This also settles
      // compaction's Token attribution — reaching this point means a
      // pending compaction is followed by this round's normal Request (a
      // compaction triggered **mid-round**, which keeps running with a
      // carry-over after compacting), so its usage belongs to this round
      // and is settled into this round's cost. After a finalization
      // compaction / manual /compact, there's no more Request in this
      // round, so the pending compaction usage never reaches this step and is discarded at finalization (not counted into this round).
      if (tsMs !== undefined) model.taskLastReqEndMs = tsMs;
      commitPendingCompaction(model.stats);
      if (p.status === "timeout" || p.status === "malformed") {
        model.reconnectRun += 1;
        model.items.push({
          kind: "reconnect",
          id: nextId(model),
          status: p.status,
          attempt: model.reconnectRun,
          retrying: false,
        });
      } else {
        model.reconnectRun = 0;
      }
      return;
    }
  }
}

function findLastRunningCompaction(model: StreamModel): CompactionItem | null {
  for (let i = model.items.length - 1; i >= 0; i--) {
    const item = model.items[i]!;
    if (item.kind === "compaction" && item.running) return item;
  }
  return null;
}

function findLastWaitingReconnect(model: StreamModel): ReconnectItem | null {
  for (let i = model.items.length - 1; i >= 0; i--) {
    const item = model.items[i]!;
    if (item.kind === "reconnect") {
      return !item.retrying && !item.gaveUp ? item : null; // earlier items each already have a resolution, don't look further back
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// origin nested routing
// ---------------------------------------------------------------------------

function routeNested(model: StreamModel, msg: OmniMessage, nowMs: number): void {
  const head = msg.origin![0]!;
  // Sub-session token_usage: the request delta counts toward this level's stats (at any depth, same convention as the CLI).
  if (isEventMessage(msg) && msg.payload.type === "token_usage") {
    trackSubagentUsage(model.stats, msg.payload as TokenUsagePayload);
  }
  touchTask(model, msg.timestamp);

  let sub = model.subagents.get(head);
  if (!sub) {
    sub = newModel(true, model.localDecisions);
    model.subagents.set(head, sub);
    bindSubagent(model, head, sub);
  }
  // Strip the first origin hop and recursively feed into the nested model.
  const rest = msg.origin!.slice(1);
  const forwarded: OmniMessage = { ...msg };
  if (rest.length > 0) forwarded.origin = rest;
  else delete forwarded.origin;
  pushMessage(sub, forwarded, nowMs);
}

/**
 * Binding rule: bind to the most recent allowed
 * (decision=allow) and not-yet-complete (output not yet complete)
 * run_subagent tool card that hasn't been bound to an origin yet; append a standalone SubagentCard if none is found.
 */
function bindSubagent(model: StreamModel, sessionId: string, sub: StreamModel): void {
  for (let i = model.items.length - 1; i >= 0; i--) {
    const item = model.items[i]!;
    if (
      item.kind === "tool_call" &&
      item.name === "run_subagent" &&
      !item.subagent &&
      !item.outputComplete &&
      item.decision === "allow"
    ) {
      item.subagent = sub;
      item.subagentSessionId = sessionId;
      return;
    }
  }
  model.items.push({ kind: "subagent", id: nextId(model), sessionId, model: sub });
}

// ---------------------------------------------------------------------------
// Overlap dedup (connect-first + dedup)
// ---------------------------------------------------------------------------

/** Build a dedup index from the envelope JSON of history's **last `limit` messages**. */
export function buildDedupIndex(messages: OmniMessage[], limit = 100): Set<string> {
  const index = new Set<string>();
  for (let i = Math.max(0, messages.length - limit); i < messages.length; i++) {
    index.add(JSON.stringify(messages[i]));
  }
  return index;
}

/** Determine whether a complete message/event is exactly identical to history's envelope JSON (overlap dedup). */
export function isDuplicate(index: Set<string>, msg: OmniMessage): boolean {
  return index.has(JSON.stringify(msg));
}

/**
 * When a complete message hits the dedup check, discard the corresponding
 * in-flight streamed fragment: if a streamed copy was fed
 * into the reducer before this complete message, its content duplicates
 * history and must be entirely removed/cleared. Routed recursively to nested models by origin.
 */
export function discardFragmentFor(model: StreamModel, msg: OmniMessage): void {
  if (msg.origin && msg.origin.length > 0) {
    const sub = model.subagents.get(msg.origin[0]!);
    if (!sub) return;
    const rest = msg.origin.slice(1);
    const forwarded: OmniMessage = { ...msg };
    if (rest.length > 0) forwarded.origin = rest;
    else delete forwarded.origin;
    discardFragmentFor(sub, forwarded);
    return;
  }
  if (msg.type !== "model_msg" || isPartialPayload(msg.payload)) return;
  const p = msg.payload as CompleteModelPayload;
  switch (p.type) {
    case "text": {
      if (p.role !== "assistant") return;
      const target = model.pendingText ?? model.openText;
      if (target) {
        removeItem(model, target);
        if (target === model.openText) model.openText = null;
        model.pendingText = null;
      }
      return;
    }
    case "thinking": {
      const target = model.pendingThinking ?? model.openThinking;
      if (target) {
        removeItem(model, target);
        if (target === model.openThinking) model.openThinking = null;
        model.pendingThinking = null;
      }
      return;
    }
    case "tool_call": {
      const card = model.toolCards.get(p.tool_call_id);
      if (card && !card.callComplete) {
        removeItem(model, card);
        model.toolCards.delete(p.tool_call_id);
      }
      return;
    }
    case "tool_call_output": {
      const card = model.toolCards.get(p.tool_call_id);
      if (card && !card.outputComplete) {
        card.output = "";
        card.outputStreaming = false;
      }
      return;
    }
    default:
      return;
  }
}

function removeItem(model: StreamModel, item: ChatItem): void {
  const idx = model.items.indexOf(item);
  if (idx >= 0) model.items.splice(idx, 1);
}
