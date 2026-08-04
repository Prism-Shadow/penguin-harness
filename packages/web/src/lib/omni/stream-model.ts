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
 *   - origin routing: messages carrying an origin go into a nested child
 *     model (surfaced in the UI as a subagent chip + the subagents panel);
 *     on a sub-session's first message it binds to "the most recent allowed
 *     (decision=allow) and not-yet-complete run_subagent tool card that
 *     hasn't been bound to an origin yet", falling back to a standalone
 *     SubagentItem if none is found; inside the nested model, the same
 *     reducer recurses (with the first origin hop stripped). Sub-session
 *     token_usage counts toward this level's stats (same convention as the CLI).
 *   - Events: approval_decision annotates the corresponding tool card
 *     (labeled "manual" if clicked on this end, "automatic" otherwise);
 *     abort → an interruption marker item; request_end ending in any status
 *     the engine reconnects on (failed/timeout/malformed) → a retry-hint item (the engine discards that
 *     attempt and resends the original input; the next request_begin marks the hint as resent, and an
 *     arriving abort marks it as retries exhausted); other request_begin/end
 *     events aren't rendered (Request duration is covered by Trace
 *     performance analysis); compaction_begin/end → a banner item;
 *     token_usage → fed into stats (task-stats.ts).
 *   - Compaction-internal messages (history rebuild): model_msg within a
 *     compaction_begin↔end range (the compaction prompt and summary output)
 *     are never rendered and never counted toward Task segmentation — aligned
 *     with the live stream (which only pushes the event pair + token_usage);
 *     user text prefixed with `[context_summary]` is a compaction-summary
 *     injection, treated as internal input (not rendered, doesn't start a new Task).
 *   - Task segmentation: a complete text/image message on the main
 *     session's user side starts a new Task; a Task ends when the live
 *     stream receives task_state:idle (notifyTaskIdle), or — during history
 *     rebuild — when the next Task starts / the stream ends
 *     (finalizeHistory). Either way the duration comes from Trace timestamps
 *     alone and never the local clock, so a round settles to the same figure
 *     watched live and replayed after a reload. A stats row is only added if token_usage occurred during the Task.
 *   - Overlap-dedup helpers: buildDedupIndex/isDuplicate
 *     judge duplicates by exact match of the envelope JSON; when a complete
 *     message hits the dedup check, discardFragmentFor also discards the corresponding in-flight fragment.
 * Docs: /docs/omni-message § "The streaming discipline".
 */
import {
  isEventMessage,
  isPartialPayload,
  parseUserSteeringText,
} from "@prismshadow/penguin-core/omnimessage";
import type {
  ApprovalDecision,
  CompactionMode,
  CompactionReason,
  CompleteModelPayload,
  EventPayload,
  OmniMessage,
  PartialModelPayload,
  SessionMetaPayload,
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

/**
 * Mid-run steering: a `[user_steering]`-wrapped user text delivered between turns
 * (see core `Session.steer`). Rendered as a compact user-styled chip **inside** the running
 * Task's flow — it never starts a new Task (`text` is the inner message, marker stripped).
 */
export interface UserSteeringItem {
  kind: "user_steering";
  id: number;
  text: string;
  /**
   * Images sent with this steering message: core delivers them as ordinary user image
   * messages right behind the text, and they are folded in here rather than rendered as
   * standalone bubbles — they are part of the same message and must not start a Task.
   * (Without vision the images arrive as `[attached image: …]` lines inside `text` instead,
   * which the chip restores at render time like any user message.)
   */
  images?: string[];
  /** Message timestamp (milliseconds): shown on footer hover. */
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

/**
 * The statuses the engine reconnects on — every LLM failure except `auth`, which is terminal
 * (see core's TURN_RETRY_STATUSES). A retry the user cannot see is a stalled session with no
 * explanation and no way out, so all three render the same countdown and the same controls.
 */
export type ReconnectStatus = "failed" | "timeout" | "malformed";

function isReconnectStatus(status: StopReason | undefined): status is ReconnectStatus {
  return status === "failed" || status === "timeout" || status === "malformed";
}

/** An LLM Request ending in failed/timeout/malformed → the engine retries carrying the content already produced. */
export interface ReconnectItem {
  kind: "reconnect";
  id: number;
  /** Trigger reason: timeout (timed out / disconnected), malformed (an incomplete or unparseable response), or failed (the provider returned an error). */
  status: ReconnectStatus;
  /** Which retry attempt this is (increments on consecutive failures within the same round; resets to 1 after a request finishes normally). */
  attempt: number;
  /** The retry request has been sent (set true by the next request_begin). */
  retrying: boolean;
  /** Retries exhausted (set true when an abort event arrives; the subsequent interruption marker item gives the reason). */
  gaveUp?: boolean;
  /**
   * The engine's planned wait before the next attempt (request_end.retry_in_ms; absent
   * when the event carried none — old Traces, or a final failure). Waits can reach the
   * 30s backoff ceiling, so the view renders a live countdown for the waiting state when
   * this is ≥2s (see ReconnectLine).
   */
  plannedDelayMs?: number;
  /**
   * CLIENT-clock arrival time of the request_end (the countdown anchor — client-local, so
   * server clock skew cannot bend the ticker). On history replay the following
   * request_begin/abort arrives immediately and flips retrying/gaveUp, so a replayed item
   * never stays in the waiting state to tick.
   */
  arrivedAtMs?: number;
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
  | UserSteeringItem
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

/**
 * Identity of a nested child session, captured from its own session_meta (a child session's
 * DTO isn't loaded by the chat page, so this is the panel's only live source for "which agent
 * runs this child"). Main-session models never fill it — their identity comes from the Session DTO.
 */
export interface NestedSessionMeta {
  /** Agent id parsed from the `agent_state` path (its parent directory name); null when unparseable. */
  agentId: string | null;
  provider: string;
  modelId: string;
  /** Session origin as recorded by core (subagent / schedule); absent = user-created. */
  source?: "subagent" | "schedule";
}

export interface StreamModel {
  items: ChatItem[];
  /** A nested sub-session model (produces no stats row; its stats count toward the parent). */
  nested: boolean;
  /** Child-session identity from its session_meta (nested models only; null until it arrives). */
  meta: NestedSessionMeta | null;
  /**
   * Elapsed-time stamps for the subagents panel's topology nodes (nested models only — the main
   * session's timing is covered by task stats). Stamped in routeNested: the `firstSeen` pair when
   * the nested model is created, the `lastActivity` pair on every message routed into its subtree
   * (cheap assignments). Two clocks are kept because neither works alone:
   *   - Local wall clock (`firstSeenLocalMs` / `lastActivityLocalMs`): when this client saw the
   *     child appear / last act. Faithful only while watching live — a history replay sets all of
   *     them within one synchronous load, so every replayed span collapses to ~0 at load time.
   *   - Message timestamps (`firstTsMs` / `lastActivityTsMs`): the same two moments in SERVER
   *     time, recorded identically during live streaming and history replay — a reload reproduces
   *     the same span. May drift from the local clock (same caveat as LiveDuration's sinceMs).
   * Topology extraction therefore derives a done node's duration from the timestamp pair (correct
   * in both live and reloaded views) and ticks a running node from firstTsMs, falling back to the
   * local pair only when timestamps were unparseable (see agent-topology.ts).
   */
  firstSeenLocalMs?: number;
  lastActivityLocalMs?: number;
  firstTsMs?: number;
  lastActivityTsMs?: number;
  stats: TaskStatsTracker;
  /** The currently open text/thinking fragment (opened by start, closed by stop). */
  openText: AssistantTextItem | null;
  openThinking: ThinkingItem | null;
  /** A fragment that has stopped and is waiting to be replaced by the complete message. */
  pendingText: AssistantTextItem | null;
  pendingThinking: ThinkingItem | null;
  /**
   * The steering chip still collecting its images: core delivers a steering message's images
   * as user image messages immediately behind its text, so an image arriving while this is
   * set belongs to that chip. Any other message closes the window (see pushMessage) — an
   * images-only Prompt sent after a steering message is a genuine new Task.
   */
  openSteering: UserSteeringItem | null;
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
  /** Consecutive reconnect-failure count (incremented when request_end carries a status the engine reconnects on, reset to zero on any other terminal status). */
  reconnectRun: number;
  /**
   * Timestamp (ms) of the most recent auth failure: a main-session `request_end` with
   * status "auth" arrived on THIS model (a subagent's request events route to the nested
   * model and never mark the parent). Only the model REFERENCE is fixed at Session
   * creation — credentials are read from the current Project config on load — so this is
   * recoverable: the composer disables itself and points at the Models page. Cleared by a
   * later completed main-session request_end (live and history replay take the same path,
   * so a Trace with an auth failure followed by a completed request does not resurrect the
   * state on reload), by a `credentials_updated` server event, or by an explicit user
   * retry/dismiss; a timestamp (not a boolean) so the composer gate can compare it against
   * the Project's credentials-updated time after a reload (see isModelAuthDead). Re-arms
   * on the next auth failure.
   */
  lastAuthFailureMs: number | null;
  /** Task segmentation state. */
  taskOpen: boolean;
  /**
   * Local-clock instant the running Task's header elapsed ticks from — display
   * only; no settled duration is ever derived from it (see finalizeOpenTask,
   * which reads Trace timestamps alone). A live stream sets it to the real
   * start; a history rebuild would otherwise stamp the page-load instant and
   * restart the ticking value from zero on every reload, so pushMessages
   * back-dates it by the elapsed already behind the Task — measured entirely
   * in server time, so no client/server clock offset reaches it, and taken
   * from the server's own clock rather than the Trace's tail so that an event
   * still in flight is counted too.
   */
  taskStartLocalMs: number;
  /** The Task's first message timestamp, in SERVER time: both the settled duration and the back-dated live anchor measure from it. */
  taskFirstTsMs: number;
  /**
   * The latest timestamp seen among this round's messages. Two readers:
   *   - the **fallback for the round's end**, used only for a degenerate
   *     round that has no request_end at all (interrupted before its first
   *     Request even ran) — the normal round-end is taken from taskLastReqEndMs;
   *   - the floor under the anchor pushMessages back-dates taskStartLocalMs
   *     to, for a round still open when a history rebuild ends. That reader
   *     fires for every such round, degenerate or not, but only decides the
   *     anchor when the server's own clock did not come back with the
   *     response — it cannot see an event still in flight.
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
   *     `[context_summary]`, and the session_meta rewritten after a file
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
    meta: null,
    stats: createTaskStatsTracker(),
    openText: null,
    openThinking: null,
    pendingText: null,
    pendingThinking: null,
    openSteering: null,
    toolCards: new Map(),
    subagents: new Map(),
    localDecisions,
    pendingDecisions: new Map(),
    pendingDecisionTs: new Map(),
    lastTsMs: 0,
    openRequestBeginMs: null,
    openApprovalWaitMs: 0,
    reconnectRun: 0,
    lastAuthFailureMs: null,
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

/**
 * Composer auth-dead gate: an auth failure is on record AND the Project's credentials have
 * not been updated since. `credentialsUpdatedMs` is the models response's `updatedAt`
 * (null = unknown / not loaded — nothing proves the credential changed, so the notice
 * stays). The time comparison is what keeps a reload honest: after a key fix the Trace
 * still ends with the auth-failed request, but that failure predates the credential update, so the
 * composer stays alive; a wrong replacement key re-arms naturally because its own auth
 * abort is newer than the update.
 */
export function isModelAuthDead(
  lastAuthFailureMs: number | null,
  credentialsUpdatedMs: number | null,
): boolean {
  if (lastAuthFailureMs === null) return false;
  return credentialsUpdatedMs === null || lastAuthFailureMs > credentialsUpdatedMs;
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
  // A steering message's images arrive as user image messages directly behind its text, with
  // nothing interleaved (core delivers the batch in one go) — so anything else on this session
  // closes the collection window opened by the chip (see openSteering). Subagent messages
  // returned above never reach here, so they leave the window alone.
  // The server answers the same "what is one Task" question over the Trace — see
  // `steeringImages` in server/src/services/trace-service.ts; the two need to stay in step.
  if (!isCompleteUserImage(msg)) model.openSteering = null;
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
    handleEvent(model, msg.payload as EventPayload, tsOf(msg.timestamp), nowMs);
    advanceLastTs(model, msg.timestamp);
    return;
  }
  // session_meta: never rendered as an item. For the main session it carries nothing the view
  // model needs (identity/config are all surfaced through the Session DTO). For a NESTED child
  // session no DTO is loaded here, so capture the identity the subagents panel needs (which
  // agent runs this child, on which model) — a rewritten session_meta (file rotation) simply
  // overwrites with the same values.
  if (msg.type === "session_meta" && model.nested) {
    const p = msg.payload as SessionMetaPayload;
    const meta: NestedSessionMeta = {
      agentId: agentIdFromStatePath(p.agent_state),
      provider: p.provider,
      modelId: p.model_id,
    };
    if (p.source !== undefined) meta.source = p.source;
    model.meta = meta;
  }
}

/** Whether the message is a complete user image — the only kind that can join an open steering chip. */
function isCompleteUserImage(msg: OmniMessage): boolean {
  return msg.type === "model_msg" && (msg.payload as { type?: string }).type === "image_url";
}

/**
 * Agent id from a session_meta `agent_state` path: the path is
 * `<root>/<projectId>/agents/<agentId>/agent_state`, so the agent id is the parent directory
 * name. Returns null when the path has no parent segment (defensive — core always writes the full path).
 */
export function agentIdFromStatePath(agentStatePath: string): string | null {
  const segments = agentStatePath.split(/[\\/]/).filter((s) => s.length > 0);
  return segments.length >= 2 ? segments[segments.length - 2]! : null;
}

/**
 * Whether any pending approval sits at or below the given origin chain (prefix match on
 * approvalKey): `chain` is the ancestor chain ending with the subtree root's own session id.
 * Drives the subagent chip's amber dot and the toolbar badge — a nested approval must stay
 * discoverable even though the child conversation lives in the side panel.
 */
export function hasPendingWithinOrigin(
  pendingKeys: Iterable<string>,
  chain: readonly string[],
): boolean {
  const prefix = chain.join("/");
  for (const key of pendingKeys) {
    // The approvalKey delimiters are load-bearing here: a key is `origin.join("/") + " " +
    // toolCallId`, so requiring the chain to be followed by a space (an approval on the subtree
    // root itself) or a slash (one strictly below it) is what keeps a sibling whose id merely
    // extends this chain ("c1" vs "c1x") from matching, and keeps a main-session key (leading
    // space) from matching any chain. Refactoring approvalKey to another separator would
    // silently break this predicate — change the two together.
    if (key.startsWith(`${prefix} `) || key.startsWith(`${prefix}/`)) return true;
  }
  return false;
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

/**
 * Replay a history rebuild. `serverNowMs` is the server's clock when it produced the
 * response (see StreamControllerDeps.loadMessages); null when unavailable.
 */
export function pushMessages(
  model: StreamModel,
  messages: OmniMessage[],
  nowMs: number = Date.now(),
  serverNowMs: number | null = null,
): void {
  for (const msg of messages) pushMessage(model, msg, nowMs);
  // Re-anchor a Task still open at the end of the replay. Every message in a
  // rebuild is fed the same `nowMs`, so startTask stamped taskStartLocalMs
  // with the instant the page loaded — and the header's live elapsed, which
  // ticks over `now − taskStartLocalMs`, would restart from zero on every
  // reload of a running Session. Back-date the anchor by the elapsed already
  // behind this Task, so the ticking value resumes where it left off:
  //
  //   now − anchor  ==  (now − loadInstant) + elapsedSoFar
  //
  // elapsedSoFar is measured in SERVER time and applied to the local clock, so
  // a client/server clock offset cancels out and never enters the result. Two
  // readings of it, the larger winning:
  //   - serverNowMs − taskFirstTsMs: the true elapsed, and the only one that
  //     covers an event still in flight — a tool executing, a Request
  //     streaming, a compaction running — where nothing has been appended to
  //     the Trace since it began. Whole-second precision (the `Date` header's
  //     format), which a chip ticking in whole seconds cannot show.
  //   - taskLastTsMs − taskFirstTsMs: the span the Trace itself proves. The
  //     fallback when no `Date` header came back, and a floor under a stale
  //     one: a cached or intermediary-rewritten reading can only be older
  //     than the true now, so it can under-report but never overshoot.
  // A live stream pushes one message at a time with the real current clock,
  // where both readings are still zero at startTask and this is a no-op.
  if (model.taskOpen) {
    const tracedSpan = model.taskLastTsMs - model.taskFirstTsMs;
    const serverSpan = serverNowMs === null ? 0 : serverNowMs - model.taskFirstTsMs;
    model.taskStartLocalMs = nowMs - Math.max(0, tracedSpan, serverSpan);
  }
}

/** The live stream received task_state:idle: finalize the current Task from its Trace timestamps. */
export function notifyTaskIdle(model: StreamModel): void {
  finalizeOpenTask(model);
}

/** History rebuild is complete (end of stream): finalize the last Task using message timestamps. */
export function finalizeHistory(model: StreamModel): void {
  finalizeOpenTask(model);
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
 * The "/" and " " separators are relied on by hasPendingWithinOrigin's prefix
 * matching — keep the two in sync if this format ever changes.
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
 * Advance this round's "latest timestamp seen among its messages" — the
 * **fallback for the round's end** (see taskLastReqEndMs: the normal
 * round-end is set by request_end, and this only guarantees a usable
 * upper bound for a degenerate round with no request_end at all,
 * interrupted before its first Request even ran), and the floor under the
 * live anchor back-dated on a history rebuild when the server's own clock
 * did not come back with the response (see taskLastTsMs, pushMessages).
 * Compaction forms its own round, and messages within its range don't
 * belong to this round, so this isn't advanced for them.
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
  finalizeOpenTask(model);
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

function finalizeOpenTask(model: StreamModel): void {
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
  //
  // Trace timestamps are the ONLY source here — the local clock is never
  // consulted, so a round settles to the same number whether it was watched
  // live or replayed from the Trace after a reload. A degenerate round (no
  // request_end at all, e.g. interrupted before its first Request even ran)
  // falls back to its message span, which the abort event's own timestamp
  // still bounds; that span is what a later reload would compute, so taking
  // the local clock instead — as this did before — only bought a number that
  // silently changed on refresh, along with idle-detection and mid-join
  // latency folded into it.
  const endMs = model.taskLastReqEndMs ?? model.taskLastTsMs;
  const elapsed = Math.max(0, endMs - model.taskFirstTsMs);
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
        // A live-tail synthetic start (mid-stream join seed) may already carry the image
        // set; same whole-set semantics as the delta branch below.
        if (p.images && p.images.length > 0) card.images = p.images;
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
        // Compaction-summary injection (`[context_summary]` prefix, an
        // internal input in the new context file): not rendered as a user bubble, doesn't
        // start a new Task. The old `<context_summary>` prefix is still recognized — old
        // Traces containing it are re-rendered through this reducer.
        if (p.text.startsWith("[context_summary]") || p.text.startsWith("<context_summary>")) {
          touchTask(model, timestamp);
          return;
        }
        // Mid-run steering (`[user_steering]`-wrapped user text, delivered between turns):
        // stays inside the running Task — it must NOT start a new Task (same exclusion idea
        // as [context_summary]) — but unlike the summary it IS rendered, as a compact
        // user-styled steering chip in-flow.
        const steering = parseUserSteeringText(p.text);
        if (steering !== null) {
          touchTask(model, timestamp);
          const steerMs = tsOf(timestamp);
          const item: UserSteeringItem = {
            kind: "user_steering",
            id: nextId(model),
            text: steering,
            ...(steerMs !== undefined ? { atMs: steerMs } : {}),
          };
          model.items.push(item);
          // Open the window for the images core delivers right behind this text.
          model.openSteering = item;
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
        // A blank body discards the fragment instead of settling it (same fidelity-only case as
        // below — core starts a text segment on the first *truthy* delta, so a whitespace-only
        // segment does stream). Blanking it in place would leave the live view showing an empty
        // bubble that a reload then drops. Removing the item and clearing both slots is what
        // discardFragmentFor does for the dedup path, and it leaves no fragment stuck streaming.
        if (!p.text.trim()) {
          removeItem(model, target);
          if (target === model.openText) model.openText = null;
          model.pendingText = null;
          return;
        }
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
      // Fidelity-only message: core emits a complete text/thinking message with an empty body
      // when the provider attached an opaque payload to an otherwise empty part — on this text
      // branch a Gemini thoughtSignature or a GPT-5 `fidelity.phase` segment marker (GPT-5's
      // encrypted reasoning rides the *thinking* branch instead) — which is why the blank bubble
      // showed up right after a thinking segment. The message has to exist so the fidelity
      // round-trips into history, but it has nothing to show, and usually no fragment was opened
      // for it either (core only starts a segment once a truthy delta arrives). Rendering it
      // produced a blank "assistant:" bubble; collectTaskAssistant already skipped these when
      // gathering the reply text, and with the blank-fragment discard above both the live and the
      // history path now agree with it.
      if (!p.text.trim()) return;
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
      // An image belonging to the steering message just rendered: it joins that chip and
      // leaves the running Task alone — unlike a Prompt's image, it starts nothing.
      if (model.openSteering) {
        touchTask(model, timestamp);
        model.openSteering.images = [...(model.openSteering.images ?? []), p.image_url];
        return;
      }
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
        // Blank body: discard the fragment rather than settle it (see the text branch).
        if (!p.thinking.trim()) {
          removeItem(model, target);
          if (target === model.openThinking) model.openThinking = null;
          model.pendingThinking = null;
          return;
        }
        target.thinking = p.thinking;
        target.streaming = false;
        if (p.stop_reason !== undefined) target.stopReason = p.stop_reason;
        settleThinkingDuration(target, tsMs);
        if (target === model.openThinking) model.openThinking = null;
        model.pendingThinking = null;
        return;
      }
      // Same fidelity-only case as the text branch above (GPT-5 encrypted reasoning): the
      // message carries the payload, not a thought to show.
      if (!p.thinking.trim()) return;
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

function handleEvent(model: StreamModel, p: EventPayload, tsMs?: number, nowMs?: number): void {
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
      // failed/timeout/malformed: the engine retries carrying the content already
      // produced, rendering a retry hint (with the attempt number); the terminal
      // statuses aren't rendered (Request duration is covered by Trace performance
      // analysis) and reset the consecutive-failure count. request events
      // within a compaction range (only visible during history rebuild)
      // are neither rendered nor counted — the compaction process only exposes the compaction event pair to the Human.
      if (model.stats.compactionActive) return;
      // Credentials lifecycle rides on the request's own terminal status:
      // - "auth" records WHEN the failure happened (the event's envelope time), so the
      //   composer gate can compare it against the Project's credentials-updated time
      //   (see lastAuthFailureMs / isModelAuthDead). Origin routing already sends a
      //   subagent's request events to the nested model, so reaching here with "auth"
      //   always means the failure belongs to THIS session.
      // - a completed request proves the credentials work (again): the auth-dead state
      //   must not outlive a success. Live and history replay share this path, so a Trace
      //   with an auth failure followed by a completed request does not resurrect the dead
      //   composer on reload.
      if (p.status === "auth") model.lastAuthFailureMs = tsMs ?? Date.now();
      if (p.status === "completed") model.lastAuthFailureMs = null;
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
      // Every status the engine reconnects on gets an item, `failed` included: it is retried
      // exactly like the other two, so leaving it out would stall the session for the whole
      // ladder with nothing on screen and no give-up control. It would also reset the counter
      // mid-ladder, renumbering a mixed timeout → failed → timeout run back to retry #1.
      if (isReconnectStatus(p.status)) {
        model.reconnectRun += 1;
        const item: ReconnectItem = {
          kind: "reconnect",
          id: nextId(model),
          status: p.status,
          attempt: model.reconnectRun,
          retrying: false,
        };
        // The engine announced its planned backoff: keep it with the CLIENT arrival time
        // as the countdown anchor (skew-free — see ReconnectItem.arrivedAtMs).
        if (typeof p.retry_in_ms === "number" && p.retry_in_ms > 0) {
          item.plannedDelayMs = p.retry_in_ms;
          item.arrivedAtMs = nowMs ?? Date.now();
        }
        model.items.push(item);
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
    sub.firstSeenLocalMs = nowMs;
    model.subagents.set(head, sub);
    bindSubagent(model, head, sub);
  }
  // Elapsed-time stamps (see the StreamModel field docs): every message routed into this child's
  // subtree — its own or a deeper descendant's — counts as its activity; the recursive pushMessage
  // below stamps the deeper hops the same way.
  sub.lastActivityLocalMs = nowMs;
  const activityTs = tsOf(msg.timestamp);
  if (activityTs !== undefined) {
    if (sub.firstTsMs === undefined) sub.firstTsMs = activityTs;
    if (sub.lastActivityTsMs === undefined || activityTs > sub.lastActivityTsMs) {
      sub.lastActivityTsMs = activityTs;
    }
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
 * run_subagent tool card that hasn't been bound to an origin yet; append a standalone SubagentItem if none is found.
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
