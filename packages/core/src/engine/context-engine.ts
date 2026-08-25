/**
 * context_engine — orchestrates the ReAct loop.
 *
 * context_engine only handles OmniMessage, orchestrating the flow of events between the
 * Human, LLM, and Environment interfaces, and writes every observable action to Trace.
 * The initial version keeps a linear message history.
 *
 * Human is the SDK's input/output boundary: there is no "Human implementation/interface".
 * Input is the Prompt list passed to `run`, plus the abort signal `signal` and the
 * per-tool approval callback `approve` in `RunOptions`; output is the OmniMessage stream
 * produced by `run`.
 *
 * Docs: packages/docs/content/agent-loop.{zh,en}.md (site path /docs/agent-loop) documents
 * the turn lifecycle, carry-over, reconnect and compaction implemented here.
 *
 * Approval is an **in-turn interaction** and tool calls are **async/incremental** (see
 * comment #24):
 *   - A single `run` call automatically runs the entire ReAct loop (no more resuming in batches);
 *   - Each tool_call is emitted as soon as its stream completes → `await approve` → if
 *     allowed, it runs via Environment;
 *   - Execution **does not block** continued consumption of the LLM stream or approval of
 *     the next tool (executions can overlap), but approvals still happen one at a time;
 *   - partial/complete `tool_call_output` is yielded in **completion order**;
 *   - once all tool outputs for the turn are ready, they become the next turn's LLM input;
 *     the Task ends once a turn produces no more tool_call.
 *
 * Implementation note: an internal queue merges "the LLM event stream + N concurrent tool
 * output streams" into a single yield sequence. GenerativeModel is a stateful object
 * (AgentHub maintains the history); each turn the engine only hands it the "new" messages:
 * the user Prompt on the first turn, and the previous turn's tool_call_output afterward.
 */
import {
  abortEvent,
  approvalDecision,
  assistantText,
  compactionBegin,
  compactionEnd,
  emptyTokenCounts,
  isCompleteModelMessage,
  isSessionMeta,
  partialText,
  requestBegin,
  requestEnd,
  subagentEvent,
  toolCallOutput,
  userText,
} from "../omnimessage/index.js";
import {
  buildContextSummaryText,
  buildTurnAbortedBlock,
  downgradeGoalInput,
  extractSummary,
  buildTurnRetriedBlock,
  transcribeText,
  transcribeThinking,
  transcribeToolCall,
  transcribeToolCallOutput,
  transcribeUserInput,
  unwrapSyntheticBlock,
  userSteeringText,
} from "../omnimessage/markers/index.js";
import type {
  ApprovalDecision,
  CompactionMode,
  CompactionReason,
  OmniMessage,
  StopReason,
  TextPayload,
  TextSender,
  ThinkingPayload,
  TokenCounts,
  TokenUsagePayload,
  ToolCallOutputPayload,
  ToolCallPayload,
} from "../omnimessage/index.js";
import type {
  ApproveFn,
  EnvironmentInterface,
  LLMInterface,
  LLMOutcome,
  ThinkingLevelName,
} from "../interfaces/index.js";

/** Trace sink: `write` a complete/event/meta message; `rotate` starts a new file (compaction splits files). */
export interface TraceSink {
  write(msg: OmniMessage): Promise<void>;
  /** Optional: start a new Trace file (index+1), used to record the new model context after compaction. */
  rotate?(): Promise<void>;
}

/**
 * Resolved context compaction settings (defaults filled in by the composition layer).
 * Docs: /docs/agent-loop § "Compaction".
 */
export interface CompactionSettings {
  /** Context token threshold (uses the most recent token_usage's request.total); <=0 disables it. */
  maxContextLength: number;
  /** Session cumulative turn threshold (counted per LLM Request, across Tasks); <=0 means no limit. */
  maxSessionTurns: number;
  mode: CompactionMode;
  /** Prompt used for summarize compaction. */
  prompt: string;
}

/** Result of one compaction run: a StopReason terminal state (completed / aborted / retryable — abandoned, made up at the next trigger / fatal — needs a config change first); carries the summary message when summarize succeeds. */
interface CompactionResult {
  status: StopReason;
  summary?: OmniMessage;
  /**
   * Whether at least one summarize attempt was **committed** by AgentHub (only a `completed`
   * attempt commits — a `retryable` attempt ends an incomplete stream and fatal/aborted
   * throw or cut off before a clean end). The carry rule at every caller is a two-case binary on
   * this flag (issue #85): committed → the input the caller folded in (mid-Task tool outputs,
   * or the carry-over a manual `compact()` folds in) now lives in the old LLM object's history
   * and must never be resent — strict providers reject the duplicates as stale tool_results;
   * not committed → the folded input is untouched and is resent exactly as before. When
   * nothing was folded in (idle/boundary compaction), the committed branch is vacuous —
   * dropping zero outputs, clearing an empty carry — so no separate "was anything absorbed"
   * signal is needed. Zero committed attempts also implies zero synthesized repairs (repairs
   * only answer a committed rejection's tool calls).
   */
  committed: boolean;
}

/**
 * Options for `run`.
 * Docs: /docs/agent-loop § "Inputs and outputs".
 */
export interface RunOptions {
  /** Abort signal (e.g. Ctrl-C). */
  signal?: AbortSignal;
  /** Per-tool approval callback; defaults to denying everything (conservative, to avoid accidental approval when unattended). */
  approve?: ApproveFn;
  /**
   * Thinking level for this run's LLM requests (a per-turn parameter): forwarded to every
   * `streamGenerate` of this run — reconnect retries included; compaction requests keep the
   * construction-time default (no override). Omitted = the LLM object's default.
   */
  thinkingLevel?: ThinkingLevelName;
}

/**
 * Engine initial state (used for Session resumption): derived by replaying Trace, so the
 * resumed engine behaves the same as before the process
 * exited. Not passed when creating a normal new Session.
 */
export interface EngineInitialState {
  /** Pending input (carry-over): resent alongside new input on the first `run` after resumption (synthetic placeholders exist only in memory, never written to Trace). */
  carryOver?: OmniMessage[];
  /** Summary recovered from a completed summarize compaction: used as the prefix of the next `run` input (merged with the user Prompt). */
  pendingSummary?: OmniMessage;
  /** Carried-over Session cumulative turn count. */
  sessionTurns?: number;
  /**
   * The resumed context was opened by a **completed** compaction (the Trace's last record is a
   * completed `compaction_end`), so it is legitimately empty. Restores `fromCompaction`, which
   * is what keeps `compactability()` answering "just compacted" rather than "nothing said yet"
   * after a restart — both have zero turns and are not the same message to a user.
   */
  fromCompaction?: boolean;
  /** Carried-over Session cumulative token counts (handed to the new object when compaction swaps it in). */
  sessionTokens?: TokenCounts;
  /** Most recent token_usage's request.total (the context usage figure, keeps compaction threshold checks continuous). */
  lastRequestTotal?: number;
  /** Recovered from a completed compaction: the context is already closed, so rotate the Trace file (index+1, writing session_meta) before the first write. */
  pendingTraceRotation?: boolean;
}

export interface ContextEngineDeps {
  llm: LLMInterface;
  environment: EnvironmentInterface;
  /** Optional Trace writer; the writer is responsible for filtering out streaming partial_* messages. */
  trace?: TraceSink;
  /** Engine initial state (derived by replaying Trace on Session resumption). */
  initialState?: EngineInitialState;
  /** Maximum LLM turns for a single Task; -1 removes the cap. Omitted means -1 too — the agent-config default and the SDK fallback agree (unlimited). */
  maxTurns?: number;
  /**
   * Maximum automatic retries for LLM timeout/reconnect within a single run. Defaults
   * to 5: with the default backoff (2s base, 30s ceiling) that is 2+4+8+16+30 ≈ 60s of
   * total patience — transient provider failures (restarts, rate limits) get a real
   * recovery window instead of five retries burning out in about a second (issue #218).
   */
  maxReconnects?: number;
  /**
   * Exponential backoff base (ms): the wait before reconnect retry N is
   * `base × 2^(N−1)`, capped at `reconnectBackoffMaxMs` (see reconnectDelayMs).
   * Defaults to 2000.
   */
  reconnectBackoffMs?: number;
  /** Ceiling (ms) for a single reconnect backoff wait. Defaults to 30000. */
  reconnectBackoffMaxMs?: number;
  /**
   * Maximum retries for a failing compaction request — one budget for every failure kind:
   * the transport statuses (see RETRY_STATUSES) and a committed response that isn't a usable
   * summary (empty, or tool calls) all draw from it; only `fatal` stops without retrying.
   * Defaults to the shared `maxReconnects`: a compaction request is an ordinary LLM request
   * and deserves the same patience (issue #170 — the earlier tighter budget made a
   * struggling provider fail compaction fast, and a session whose every turn re-triggers
   * compaction is stuck). Failure stays graceful either way: the original context is kept
   * and compaction retries at the next trigger.
   */
  compactionMaxReconnects?: number;
  /**
   * Creates a new LLM object after compaction (a fresh model context); the argument is the
   * current Session cumulative token counts, for the new object to carry forward
   * (token_usage.session stays continuous across compaction). Context compaction is
   * unavailable if this is not provided.
   */
  createLLM?: (sessionTokens: TokenCounts) => LLMInterface;
  /** Context compaction settings; only takes effect if provided together with `createLLM`. */
  compaction?: CompactionSettings;
  /** This Session's session_meta message; written at the start of the new Trace file after compaction splits it. */
  sessionMeta?: OmniMessage;
  /**
   * This Session's tool_list_ready event (the resolved toolset). Written once right after
   * the first run's input (following `bootstrapRecords`), and rewritten right after
   * sessionMeta on each post-compaction Trace file — every file's tool record stays
   * self-contained. Held here alone; deliberately NOT part of `bootstrapRecords`, so the
   * one message isn't carried twice.
   */
  toolList?: OmniMessage;
  /**
   * The first run's mcp_connect begin/end pair (empty without MCP), written once right
   * AFTER that run's input messages — followed by `toolList` — so the connect phase lands
   * inside the new turn in the Trace, after the user's message (their timestamps precede
   * the write; the file stays chronologically consistent because the input message was
   * created before the connect began). Streaming already yielded them live before the
   * engine existed. Present (possibly empty) marks "first-run records still owed".
   */
  bootstrapRecords?: OmniMessage[];
  /**
   * Input adapter for a session whose model has no vision: folds image messages into text
   * lines appended to the input's user text. Absent = the model takes images directly. `run`'s
   * Prompt is folded by the caller before it reaches the engine; this hook exists for the one
   * input the engine assembles itself — steering (see `steeringMessages`).
   *
   * Expected to settle rather than reject: it runs mid-Task, and Session's binding already
   * degrades a failure into text saying the images were dropped.
   */
  foldInputImages?: (messages: OmniMessage[]) => Promise<OmniMessage[]>;
  /**
   * Background-task completion notices (harness user messages the Session queues when a
   * `run_in_background` task settles — see Session's notice queue). Pull seam: the engine
   * drains at every input-assembly point — run start included — yielding each message to the
   * output stream and writing it to Trace (like steering, this text never reached the
   * consumer any other way); `pending` is the boundary peek that keeps a discard/summary
   * from ending the run while notices still wait. This drain IS the steering delivery path:
   * the source builds each message with `delivery: steering` on its block, marking it as
   * injected into an already-started Task rather than a task-starting input (only the host's
   * idle take produces the unstamped form). Absent = no notice source (tests, standalone
   * embedders).
   */
  backgroundNotices?: { drain(): OmniMessage[]; pending(): number };
}

const isImageMessage = (m: OmniMessage): boolean =>
  (m.payload as { type?: string }).type === "image_url";

/** Whether a message carries steering of its own — an image, or text that isn't blank. */
const carriesSteering = (m: OmniMessage): boolean => {
  const p = m.payload as { type?: string; text?: string };
  return p.type === "image_url" || (p.type === "text" && (p.text ?? "").trim().length > 0);
};

/** Whether compaction is possible; when not `ok`, `compact()` is a no-op and yields no messages (see ContextEngine.compactability). */
export type CompactAvailability = "ok" | "unsupported" | "empty" | "just_compacted";

/** The context facts the availability rule reads (see `compactAvailability`). */
export interface CompactabilityState {
  /** Whether the compaction capability is configured at all (settings + the new-context LLM factory). */
  configured: boolean;
  /** Completed turns in the **current** context (reset by compaction, restored from Trace on resume). */
  sessionTurns: number;
  /** Whether the current context was opened by a completed compaction rather than by the user. */
  fromCompaction: boolean;
}

/**
 * The compaction-availability rule, stated once.
 *
 * Two callers answer the same question from different vantage points and must not drift apart:
 * a live `ContextEngine` reads its own counters, while a `Session` resumed after a process
 * restart has no engine yet (it is built by the first run's bootstrap) and answers from the
 * state its Trace replay recovered. Duplicating the rule is how "restart the client and it
 * claims there is nothing to compact" happens.
 */
export function compactAvailability(state: CompactabilityState): CompactAvailability {
  if (!state.configured) return "unsupported";
  if (state.sessionTurns > 0) return "ok";
  // Both remaining cases have zero turns and mean completely different things to the user.
  return state.fromCompaction ? "just_compacted" : "empty";
}

/**
 * Corrective note prepended to the re-sent compaction Prompt after a committed-but-unusable
 * response (empty summary, or tool calls — issues #83/#170). The unusable
 * response is committed on the live LLM object and can only be *appended* to (rewriting the
 * prefix would invalidate the provider's prompt cache at the moment the context is largest —
 * the same invariant that pins the toolset, issue #84); without an explicit correction the
 * model sees its own bad output as the freshest example and copies it verbatim on every
 * retry (issue #170: deepseek-v4-flash kept writing the body after `[/summary]`).
 * Exported for unit tests.
 */
export const SUMMARY_RETRY_GUIDANCE =
  "Your previous reply was not a usable summary. Reply again with text only, no tool " +
  "calls, in exactly this format and nothing after it:\n\n" +
  "[summary]put the summary text here...[/summary]";

/** Result of executing one LLM turn (the return value of runTurn). */
interface TurnResult {
  /** All tool outputs for this turn, reordered to match the original tool_call order (for the next turn's LLM input). */
  toolOutputs: OmniMessage[];
  /** tool_calls issued by the model this turn (in original order, real requests only). */
  toolCalls: OmniMessage<ToolCallPayload>[];
  /** Complete thinking/text segments produced by the model this turn (including partial segments finalized on interruption), for carry-over flattening. */
  assistantSegments: OmniMessage[];
  /** Terminal state of this turn's LLM request (completed / failed / aborted / timeout / malformed). */
  outcome: LLMOutcome;
}

/**
 * Merge queue: lets multiple concurrent producers (the LLM stream consumer + several tool
 * executions) push OmniMessage entries; a single consumer (run's generator) pulls and
 * yields them in push order. Finishes once all producers are done and the queue is drained.
 * Docs: /docs/message-flow § "The merge point: MergeQueue".
 */
class MergeQueue {
  private items: OmniMessage[] = [];
  private producers = 0;
  private wake: (() => void) | null = null;

  /** Registers a producer. */
  addProducer(): void {
    this.producers += 1;
  }

  /** Deregisters a producer (its stream has finished). */
  removeProducer(): void {
    this.producers -= 1;
    this.signal();
  }

  /** Pushes a message and wakes the consumer. */
  push(msg: OmniMessage): void {
    this.items.push(msg);
    this.signal();
  }

  private signal(): void {
    if (this.wake) {
      const w = this.wake;
      this.wake = null;
      w();
    }
  }

  /** Takes the next message; waits if empty but producers remain; returns null if empty and no producers remain. */
  async next(): Promise<OmniMessage | null> {
    for (;;) {
      if (this.items.length > 0) return this.items.shift()!;
      if (this.producers === 0) return null;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }
}

/**
 * Rewrites a dead goal's round input before carry-over re-sends it.
 *
 * How such a message gets here: a goal round is interrupted (user stop, LLM failure,
 * reconnect exhaustion) → the interruption also ends the whole goal → yet the engine still
 * holds that round's input in pendingCarryOver and will prepend it to the NEXT task's
 * request. Without this rewrite the model would receive the full protocol block as if it
 * were current instructions and likely resume chasing the dead objective instead of the
 * user's new task:
 *
 *     [goal]
 *     round: 1
 *     This message was sent automatically by goal mode: work toward the objective …
 *     … GOAL.yaml path and status rules, completion/blocked audits …
 *     [/goal]
 *
 *     make all tests pass
 *
 * The rewrite keeps the context but kills the instructions:
 *
 *     [goal round 1 of an ended goal run — protocol omitted; do not act on it]
 *     make all tests pass
 *
 * Only user text that parses as a goal round is touched — tool outputs (the pairing
 * carry-over), events, and plain user text pass through unchanged. Applied at the two
 * carry-over CONSUMER sites (next-run input assembly, manual-compact summarize) rather
 * than at each hold site, which also covers carry-over rebuilt by resume; the
 * [turn_aborted] transcript path is handled separately at transcription time
 * (buildTurnAbortedText). The downgrade itself lives in markers/goal-block.ts.
 */
function downgradeCarriedGoalInput(msg: OmniMessage): OmniMessage {
  const p = msg.payload as { type?: string; role?: string; text?: string };
  if (msg.type !== "model_msg" || p.type !== "text" || p.role !== "user" || !p.text) return msg;
  const downgraded = downgradeGoalInput(p.text);
  if (downgraded === p.text) return msg;
  return { ...msg, payload: { ...msg.payload, text: downgraded } as OmniMessage["payload"] };
}

/**
 * LLM outcomes that reconnect in-run: exactly `retryable`. The classification lives in the
 * LLM interface (see LLMOutcome) — transport drops, timeouts, 408/429/5xx, malformed
 * responses and everything unclassifiable come back `retryable`, while definitive provider
 * rejections and credential failures come back `fatal` and the turn loop aborts on them
 * before consulting this set.
 *
 * Both loops retry the same set on the same backoff ladder, and by default with the same
 * budget: compaction runs on `compactionMaxReconnects`, which follows `maxReconnects` unless
 * set explicitly (issue #170 — a compaction request is an ordinary LLM request and gets the
 * turn loop's patience; compaction additionally routes a committed-but-unusable summary
 * through the same budget, see summarizeContext).
 */
const RETRY_STATUSES: readonly StopReason[] = ["retryable"];

/**
 * Delay before reconnect attempt N (1-based): exponential growth from `base` with a hard
 * ceiling `max` — `min(base × 2^(N−1), max)`. With the defaults (2s base, 30s ceiling,
 * 5 reconnects) the ladder is 2s, 4s, 8s, 16s, 30s ≈ 60s of total patience: one shared
 * schedule serves every retryable class. The base is sized for the slow ones — transient
 * provider failures (restarts, rate limits) need seconds, not milliseconds, to
 * recover, and the old 250ms base burned the whole ladder in ~7.75s (issue #218); it also
 * keeps every planned wait at or above the hosts' 2s countdown floor (the Web App's
 * COUNTDOWN_MIN_MS), so no retry ever looks like a silent stall. Transport blips pay at
 * most one visible 2s wait — an acceptable trade for retries the user can see.
 */
export function reconnectDelayMs(base: number, max: number, attempt: number): number {
  return Math.min(base * 2 ** (attempt - 1), max);
}

export class ContextEngine {
  private readonly maxTurns: number;
  private readonly maxReconnects: number;
  private readonly reconnectBackoffMs: number;
  private readonly reconnectBackoffMaxMs: number;
  private readonly compactionMaxReconnects: number;
  /** Interruption cleanup: content to resend generated when the previous run was aborted, held on the engine across runs. */
  private pendingCarryOver: OmniMessage[] = [];
  /** Current LLM object; swapped for a new one created by `createLLM` after a successful compaction (a fresh model context). */
  private llm: LLMInterface;
  /** Session cumulative turn count: counted per LLM Request that produces token_usage, across Tasks; reset to zero after compaction completes. */
  private sessionTurns = 0;
  /** Whether the current context was produced by a compaction (`startNewContext`); this flag becomes meaningless once a new completed turn occurs. */
  private fromCompaction = false;
  /** Most recent token_usage's request.total, i.e. the current context usage figure. */
  private lastRequestTotal = 0;
  /** Most recent token_usage's session cumulative counts, handed to the new LLM object when compaction swaps it in. */
  private lastSessionTokens: TokenCounts = emptyTokenCounts();
  /** Summary produced by a Task-boundary compaction: used as the prefix of the next `run` input (merged with the next user Prompt). */
  private pendingSummary: OmniMessage | null = null;
  /** Bootstrap records still owed to the Trace (written after the first run's input); see ContextEngineDeps.bootstrapRecords. */
  private pendingBootstrapRecords: OmniMessage[] | null = null;
  /**
   * Set to true once compaction completes: Trace rotation is deferred until the next
   * message that needs writing (see `write`) — so that if no further messages follow the
   * compaction, we don't create an empty file containing only session_meta.
   */
  private pendingTraceRotation = false;
  /**
   * Steering queue: user messages sent mid-run (`steer`). Drained at every next-input
   * assembly — after each turn (delivered as standalone `[user_steering]` user messages
   * alongside that turn's tool outputs, or alone as the continuation input when the turn
   * produced no tool calls) and after a completed mid-run compaction (so steering that
   * arrived during the compaction request is delivered, never swallowed). Only accepts
   * entries while a run is in flight; the queue is discarded **only when the run exits**
   * — abort, LLM failure, or a plain race with completion (the abort event / task end
   * already hands control back to the user, and silently replaying stale steering into a
   * later Task would be more surprising than losing it; hosts get `steer() === false`
   * after that point and fall back to a normal task).
   */
  private steeringQueue: OmniMessage[][] = [];
  /** Whether a `run` is currently in flight (gates `steer`; compaction does not count). */
  private taskRunning = false;

  /** Whether a `run` is in flight (the Session's notice routing keys on this: a running task delivers notices at the next boundary; an idle one goes through the host). */
  get isTaskRunning(): boolean {
    return this.taskRunning;
  }

  /** Background notices still waiting at the source (boundary peek; see ContextEngineDeps.backgroundNotices). */
  private pendingNoticeCount(): number {
    return this.deps.backgroundNotices?.pending() ?? 0;
  }

  /**
   * Drains queued background-task notices into the stream: each is yielded and written to
   * Trace (mid-run input the consumer has never seen, same rationale as deliverSteering),
   * and returned for the caller to append to the next request input. Delivered BEFORE
   * steering at every assembly point — the user's own words come last.
   */
  private async *deliverBackgroundNotices(): AsyncGenerator<OmniMessage, OmniMessage[]> {
    const messages = this.deps.backgroundNotices?.drain() ?? [];
    for (const msg of messages) {
      yield msg;
      await this.write(msg);
    }
    return messages;
  }

  constructor(private readonly deps: ContextEngineDeps) {
    this.pendingBootstrapRecords = deps.bootstrapRecords ?? null;
    this.maxTurns = deps.maxTurns ?? -1;
    this.maxReconnects = deps.maxReconnects ?? 5;
    this.reconnectBackoffMs = deps.reconnectBackoffMs ?? 2000;
    this.reconnectBackoffMaxMs = deps.reconnectBackoffMaxMs ?? 30_000;
    this.compactionMaxReconnects = deps.compactionMaxReconnects ?? this.maxReconnects;
    this.llm = deps.llm;
    // Session resumption: apply the initial state derived from replay.
    const init = deps.initialState;
    if (init) {
      this.pendingCarryOver = init.carryOver ?? [];
      this.pendingSummary = init.pendingSummary ?? null;
      this.sessionTurns = init.sessionTurns ?? 0;
      this.fromCompaction = init.fromCompaction ?? false;
      this.lastSessionTokens = init.sessionTokens ?? emptyTokenCounts();
      this.lastRequestTotal = init.lastRequestTotal ?? 0;
      this.pendingTraceRotation = init.pendingTraceRotation ?? false;
    }
  }

  /**
   * Runs a Task to completion, streaming out OmniMessage. `newMessages` is this call's
   * Prompt (only the newly added input, not the full history — history is maintained by the
   * stateful GenerativeModel); `opts.signal` is the abort signal, `opts.approve` is the
   * per-tool approval callback.
   * Docs: /docs/agent-loop § "The loop at a glance".
   */
  async *run(newMessages: OmniMessage[], opts?: RunOptions): AsyncGenerator<OmniMessage> {
    // Steering window: only while this generator is being driven. The finally also covers
    // abort/failure exits — anything still queued is discarded (see steeringQueue).
    this.taskRunning = true;
    try {
      yield* this.runToCompletion(newMessages, opts);
    } finally {
      this.taskRunning = false;
      this.steeringQueue = [];
    }
  }

  /**
   * Queues a steering message for the running Task: it is delivered with the next request
   * input as a standalone `[user_steering]` user message — alongside that turn's tool
   * outputs, or alone as the continuation input when the turn produced no tool calls.
   * `input` is an OmniMessage list, the shape `run` takes a Prompt in: its user text becomes
   * the block's body and its images ride behind that text, exactly as a Prompt carries them;
   * on a model without vision they are folded into path lines at delivery (see
   * deliverSteering). Returns false when no Task is running (the host should then submit the
   * message as a normal task instead).
   *
   * An input with neither text nor images queues nothing and still returns true: `false` is
   * specifically "send this as a normal task", which would be the wrong advice for an empty
   * one. Every host guards against this already; the check is here so an empty
   * `[user_steering]` block can't reach the model through a host that forgets.
   */
  steer(input: OmniMessage[]): boolean {
    if (!this.taskRunning) return false;
    if (!input.some(carriesSteering)) return true;
    this.steeringQueue.push(input);
    return true;
  }

  /**
   * Withdraws a queued steering input that has not been delivered yet. `input` is the exact
   * list previously passed to `steer` (matched by identity — the host that queued it is the
   * one recalling it, and it holds the reference). Returns false when the entry is no longer
   * in the queue: it was already drained into the next request input (or the run exited),
   * which the host surfaces as "already delivered" rather than an error.
   */
  unsteer(input: OmniMessage[]): boolean {
    const i = this.steeringQueue.indexOf(input);
    if (i < 0) return false;
    this.steeringQueue.splice(i, 1);
    return true;
  }

  /**
   * Drains the steering queue into standalone `[user_steering]` user messages (one per
   * queued entry, in arrival order, each followed by its images), yielding every message to
   * the output stream and writing it to Trace — steering is real user input: unlike a normal
   * Prompt (which the render layer already holds locally) this text never reached the
   * consumer, and replay attributes it positionally to the next turn's input like any other
   * user message. Returns the messages for the caller to append to the next request input;
   * an empty queue is a no-op.
   */
  private async *deliverSteering(): AsyncGenerator<OmniMessage, OmniMessage[]> {
    if (this.steeringQueue.length === 0) return [];
    const drained = this.steeringQueue;
    this.steeringQueue = [];
    const messages: OmniMessage[] = [];
    for (const input of drained) messages.push(...(await this.steeringMessages(input)));
    for (const msg of messages) {
      yield msg;
      await this.write(msg);
    }
    return messages;
  }

  /**
   * One queued steering input -> the messages carrying it: its user text collected into the
   * `[user_steering]`-wrapped message, followed by everything else it held — the images, on a
   * vision model. That is the shape a Prompt uses, so every consumer down the line — LLM
   * client, Trace, replay — already knows it.
   *
   * When `deps.foldInputImages` is given, the input goes through it **before** the wrapping so
   * the images land inside the block: `parseUserSteeringText` only recognizes a text that is
   * exactly one block, and anything appended after the closing tag would cost the message its
   * steering identity — every render layer would read it as a new Task.
   */
  private async steeringMessages(input: OmniMessage[]): Promise<OmniMessage[]> {
    // No images, no fold: an image-free steering message is the same message either way.
    const fold = input.some(isImageMessage) ? this.deps.foldInputImages : undefined;
    const messages = fold ? await fold(input) : input;
    const texts: string[] = [];
    // The delivered [user_steering] message keeps the queued input's sender: a parent agent
    // steering its child (input_subagent) records as "parent_agent" in the child's Trace,
    // while human steering keeps the field absent — origin stays a structural fact.
    let sender: TextSender | undefined;
    const rest: OmniMessage[] = [];
    for (const msg of messages) {
      const p = msg.payload as { type?: string; role?: string; text?: string; sender?: TextSender };
      if (p.type === "text" && p.role === "user") {
        texts.push(p.text ?? "");
        sender ??= p.sender;
      } else rest.push(msg);
    }
    // `foldInputImages` is public API, so a third-party adapter can return something else, and
    // both ways it can break lose the picture: an image that survived the fold goes to the one
    // model known to refuse it, and no text at all means the images were dropped rather than
    // written down as paths. Name the contract instead of delivering a steering message that
    // lost what it was sent to carry.
    if (fold && (rest.some(isImageMessage) || texts.length === 0)) {
      throw new Error("foldInputImages must return the input's images folded into a user text.");
    }
    return [userText(userSteeringText(texts.join("\n\n")), sender), ...rest];
  }

  /** The actual Task loop behind `run` (split out so run's finally can close the steering window on every exit path). */
  private async *runToCompletion(
    newMessages: OmniMessage[],
    opts?: RunOptions,
  ): AsyncGenerator<OmniMessage> {
    const signal = opts?.signal;
    // Default approval policy: deny (conservative). CLI/Web will inject a real callback (interactive or permission-mode based).
    const approve: ApproveFn = opts?.approve ?? (async () => "deny");
    // Per-turn thinking level: applies to each of this run's LLM requests (reconnects included);
    // compaction requests are out of scope and keep the LLM default.
    const thinkingLevel = opts?.thinkingLevel;

    // Merge the Task-boundary compaction summary (the new context's first input, merged with
    // this Prompt), the carry-over left over from the last interruption, and this call's new
    // input, to form this Request's input.
    const summary = this.pendingSummary;
    this.pendingSummary = null;
    const carryOver = this.pendingCarryOver.map(downgradeCarriedGoalInput);
    this.pendingCarryOver = [];
    const prefix = summary ? [summary, ...carryOver] : carryOver;
    const input = prefix.length ? [...prefix, ...newMessages] : newMessages;

    // Input is written to Trace (Prompt record, incl. audit trail) but not replayed to
    // the render layer. carry-over is not written to Trace: real messages (tool outputs etc.)
    // are already written when produced; synthetic content (flatten text, backfilled
    // placeholders) is **sent to the model only, never persisted** — Trace records only real
    // messages, and resumption replay best-effort reconstructs from original messages.
    // Exception: the compaction summary, which is the new
    // context's first input record, is written as usual.
    if (summary) await this.write(summary);
    for (const msg of newMessages) await this.write(msg);
    if (this.pendingBootstrapRecords) {
      // First run only: the connect pair, then the toolset record, follow the input into
      // the Trace (see ContextEngineDeps.bootstrapRecords for the ordering rationale).
      for (const msg of this.pendingBootstrapRecords) await this.write(msg);
      this.pendingBootstrapRecords = null;
      if (this.deps.toolList) await this.write(this.deps.toolList);
    }

    if (signal?.aborted) {
      // Aborted before the Request was issued: the input is held **as-is** as carry-over
      // (trailing-input semantics: input the Request never got to send is kept unchanged)
      // — not flattened, so replay matches in-process behavior and
      // multimodal input isn't lost. The message is already written to Trace, so it won't be
      // rewritten on the next send.
      this.pendingCarryOver = input;
      yield* this.emitAbort("aborted by user");
      return;
    }

    let turnCount = 0;
    // Each turn's LLM input: the first turn is the Prompt, later turns are the previous turn's
    // tool outputs. Background notices that arrived while the session sat idle (and were not
    // taken by the host as their own task input) ride the first request, behind the Prompt.
    let nextInput: OmniMessage[] = input;
    const startNotices = yield* this.deliverBackgroundNotices();
    if (startNotices.length > 0) nextInput = [...nextInput, ...startNotices];

    for (;;) {
      // max_turns guard: emit a length notice and stop once exceeded. A non-positive cap
      // (-1 per the config contract "must be > 0 or -1") disables the guard entirely —
      // same convention as maxSessionTurns in shouldCompact (issue #55: -1 used to trip
      // `0 >= -1` and stop before the first turn).
      if (this.maxTurns > 0 && turnCount >= this.maxTurns) {
        // This turn's pending input (usually the previous turn's tool outputs) was never
        // submitted to the LLM: hold it as carry-over, to be resent merged with new input on
        // the next `run` (same as interruption-cleanup case A) — the previous turn's assistant
        // tool_call has already been committed by AgentHub, so discarding its paired output and
        // sending a fresh message would be rejected by the provider as an unanswered tool_use
        // (400, see issue #33).
        this.pendingCarryOver = nextInput;
        yield* this.emitMaxTurns();
        return;
      }
      turnCount += 1;

      // This turn's input. The safety invariant behind resending it: **no retryable attempt
      // is ever committed to AgentHub's history**. AgentHub appends a turn to `_history` only
      // after its stream has been consumed to the end and validated, so every abnormal exit —
      // whether the stream was cut, the payload failed to parse, or the request was rejected
      // outright — leaves history untouched.
      // Nothing can therefore be duplicated or left as an unanswered tool_use by a reconnect;
      // that is what makes it safe to resend this turn's input unchanged, appending a
      // `[turn_retried]` block carrying what the failed attempt already produced — the model
      // continues from there instead of re-running tools; the tag is distinct from the
      // user-interruption `[turn_aborted]`. (The one attempt that IS committed — a fully
      // delivered response whose finish_reason arrived — is forced to `completed` in
      // GenerativeModel precisely so it never reaches this loop.)
      const failedTurns: TurnResult[] = [];
      let attemptInput = nextInput;
      let reconnects = 0;
      let turn: TurnResult;

      for (;;) {
        // Both LLM and Environment handle errors internally and guarantee a complete, closed
        // output with no thrown exceptions; the engine doesn't handle exceptions —
        // it decides retry/resend purely from `outcome`. The retry count so far is threaded
        // in so the turn's request_end can announce the planned backoff (retry_in_ms) —
        // the counter lives in this loop while the event is built inside the turn.
        turn = yield* this.runTurn(attemptInput, approve, signal, thinkingLevel, reconnects);

        // User interruption (the LLM stream was aborted, outcome=aborted, or `signal` fired
        // during tool execution): stop and hand control back to the user.
        if (signal?.aborted || turn.outcome.status === "aborted") {
          this.pendingCarryOver = this.buildCarryOver(attemptInput, turn);
          yield* this.emitAbort("aborted by user");
          return;
        }
        // `fatal` stops the run: a definitive provider rejection, a dead credential, or a
        // deterministic client-side rejection — the identical request can never succeed, so
        // the ladder would only delay the actionable message the outcome already carries.
        if (turn.outcome.status === "fatal") {
          this.pendingCarryOver = this.buildCarryOver(attemptInput, turn);
          yield* this.emitAbort(`llm request error: ${turn.outcome.errorMessage ?? "unknown"}`);
          return;
        }
        // Completed normally.
        if (turn.outcome.status === "completed") break;

        // `retryable` remains: reconnect automatically within the same run. The class is
        // deliberately wide — the LLM interface sends every unclassifiable error here,
        // because its fatal detector is an allowlist and a gateway phrasing a transient
        // fault its own way (`Upstream HTTP/2 stream failed (upstream_http2_stream_error)`)
        // must keep its retries; the concrete failure rides on errorMessage.
        //
        // When retries are exhausted or the backoff is interrupted, the retry input is held
        // as-is as carry-over (the original input is already written to Trace, so it isn't
        // rewritten). The frontend surfaces the retry process and count via
        // request_end(retryable) followed by the next request_begin.
        failedTurns.push(turn);
        attemptInput = this.withRetriedTurns(nextInput, failedTurns);
        if (reconnects >= this.maxReconnects) {
          this.pendingCarryOver = attemptInput;
          // This reason is user-visible (the Web App's error panel, the CLI's abort line) and
          // is what observability persists as the error message, so it has to read as a
          // sentence: what gave out, then how many attempts it took, then the concrete
          // detail, last — when the final failure carried one.
          const detail = turn.outcome.errorMessage;
          const reason = `llm request failed after ${this.maxReconnects} retries${detail ? `: ${detail}` : ""}`;
          yield* this.emitAbort(reason);
          return;
        }
        reconnects += 1;
        if (!(await this.backoff(reconnects, signal))) {
          this.pendingCarryOver = attemptInput;
          yield* this.emitAbort("aborted during reconnect backoff");
          return;
        }
      }

      // Compaction checkpoint: after every LLM Request produces token_usage. This also
      // applies mid-Task — when runTurn returns, all of this turn's
      // tool results are ready and paired with their tool_call.
      const midTask = turn.toolOutputs.length > 0;
      const compactionReason = this.compactionTrigger();
      if (compactionReason) {
        const mode = this.deps.compaction!.mode;
        if (mode === "discard") {
          // Once discarded, the current Task can't continue: defer until the Task really
          // ends (mid-Task, or steering/notices still queued that must continue the loop).
          // The queues are only peeked here — delivery happens at the input assembly below.
          if (!midTask && this.steeringQueue.length === 0 && this.pendingNoticeCount() === 0) {
            yield* this.discardContext(compactionReason);
            return;
          }
        } else {
          const result = yield* this.summarizeContext(
            compactionReason,
            midTask ? turn.toolOutputs : [],
            signal,
          );
          if (result.status === "completed") {
            // Boundary check against the **live** queues: steering or a background notice
            // may have arrived during the multi-second compaction request and must not be
            // swallowed (no await sits between this check and the return, so the window
            // cannot reopen).
            if (!midTask && this.steeringQueue.length === 0 && this.pendingNoticeCount() === 0) {
              // Task boundary: the summary is merged with the next user Prompt as the new
              // context's first input.
              this.pendingSummary = result.summary!;
              return;
            }
            // Mid-Task: the summary itself becomes the new LLM object's first input (this
            // turn's tool results were already folded into the compaction request and absorbed
            // into the summary); continuation relies on the model's own next-step plan written
            // into the summary, with no hardcoded continuation instruction appended. Queued
            // steering (including anything that arrived during the compaction request) is
            // delivered right after the summary as standalone [user_steering] user turns.
            await this.write(result.summary!);
            const injected = [
              ...(yield* this.deliverBackgroundNotices()),
              ...(yield* this.deliverSteering()),
            ];
            nextInput = [result.summary!, ...injected];
            continue;
          }
          // failed or aborted: keep the original context and Trace index — the compaction is
          // made up later, at the next trigger or a manual /compact (no fallback to
          // discard). Mid-Task the run ends through the interruption flow: this turn's
          // pending state is held as carry-over under the same two-case binary as everywhere
          // (issue #85) — a committed attempt consumed the turn's outputs into history, so
          // only the repair stash summarizeContext left in pendingCarryOver still needs
          // resending; otherwise the outputs are untouched and are appended behind the stash
          // as case-A carry-over. The next run resends that carry-over merged with the
          // user's message, exactly like any interrupted turn, and the still-standing
          // threshold re-triggers the compaction there. The abort also discards the steering
          // queue (run's finally — control goes back to the user).
          if (midTask) {
            if (!result.committed) {
              this.pendingCarryOver = [
                ...this.pendingCarryOver,
                ...this.buildCarryOver(attemptInput, turn),
              ];
            }
            yield* this.emitAbort(
              result.status === "aborted" ? "aborted during compaction" : "compaction failed",
            );
            return;
          }
          // Task boundary: the final reply has already streamed out. A user abort hands
          // control straight back; a failure falls through — queued steering may still
          // continue the loop, and the assembly below otherwise ends the run.
          if (result.status === "aborted") return;
        }
      }

      // Next-input assembly — the injection delivery point: queued background notices
      // (harness user messages) and steering ([user_steering] user messages) ride alongside
      // this turn's tool outputs (or alone as the continuation input when the turn produced
      // no tool calls, instead of ending the Task — subject to the max-turns guard at the
      // top of the loop). Notices first; the user's own words come last. The whole batch is
      // user-side and reaches AgentHub as ONE user message (streamGenerate merges a
      // request's input into a single UniMessage), so injections never put two adjacent
      // user messages on the wire — the per-message granularity exists only in the
      // OmniMessage stream and the Trace.
      const injected = [
        ...(yield* this.deliverBackgroundNotices()),
        ...(yield* this.deliverSteering()),
      ];
      // No tool_call this turn and nothing injected -> the Task ends (the final reply has
      // already been streamed out). A compaction stash, if any, rides the next run.
      if (!midTask && injected.length === 0) return;
      // Anything a failed boundary compaction stashed (synthesized repair outputs from
      // rejected attempts) rides the very next request, ahead of the turn outputs so
      // tool_results stay contiguous and first.
      const stashed = this.pendingCarryOver;
      this.pendingCarryOver = [];
      nextInput = [...stashed, ...turn.toolOutputs, ...injected];
      if (nextInput.length === 0) return;
    }
  }

  /**
   * User-initiated compaction request (e.g. a CLI command): reuses the automatic compaction
   * flow without checking thresholds (reason=manual). Only callable at a Task boundary (between
   * runs); streams out paired compaction events. No-op when compaction is not configured.
   *
   * Carry-over left over from an interruption is cleaned up here too: summarize folds it into
   * the compaction request (structured tool outputs keep their pairing with the already
   * committed tool_call, otherwise the compaction request itself would be rejected by the
   * provider as an unanswered tool_use, see issue #33; flatten text is absorbed into the
   * summary); discard drops the structured outputs paired with the old context, keeping only the
   * self-contained flatten text.
   */
  /**
   * Whether compaction is possible, and the **reason** when it isn't.
   *
   * `compact()` is a no-op and **yields no messages** in these cases; if the UI treats invoking
   * it as a successful start, it ends up waiting forever for a compaction banner that never
   * arrives — that's exactly how "/compact does nothing after an interruption" happens. Callers
   * (Web / CLI) should give feedback upfront based on this.
   *
   *   - `unsupported`: compaction capability is not configured;
   *   - `empty`: the current context hasn't completed a single turn (`sessionTurns` only
   *     increments when `token_usage` arrives — a turn only counts once the request finishes
   *     normally, so it's still 0 right after the first request is interrupted);
   *   - `just_compacted`: no new conversation since the last compaction. Both cases have
   *     `sessionTurns` === 0, but they mean two completely different things to the user and must
   *     not be conflated.
   *
   * The rule itself lives in `compactAvailability` so that a Session resumed after a restart —
   * which has no engine yet — answers identically from its replayed state.
   */
  compactability(): CompactAvailability {
    return compactAvailability({
      configured: Boolean(this.deps.compaction && this.deps.createLLM),
      sessionTurns: this.sessionTurns,
      fromCompaction: this.fromCompaction,
    });
  }

  async *compact(opts?: { signal?: AbortSignal }): AsyncGenerator<OmniMessage> {
    if (!this.deps.compaction || !this.deps.createLLM) return;
    // The current context has no completed LLM turns: nothing to compact, return immediately.
    // This also guards against two /compact calls in a row — the new context is empty right
    // after the previous compaction, so running again would overwrite the not-yet-consumed
    // pendingSummary with an "empty summary," permanently losing the only record of the prior
    // conversation.
    if (this.sessionTurns === 0) return;
    if (this.deps.compaction.mode === "discard") {
      this.pendingCarryOver = this.pendingCarryOver.filter(
        (m) => (m.payload as { type?: string }).type !== "tool_call_output",
      );
      yield* this.discardContext("manual");
      return;
    }
    // The carry seam is a clean binary on whether the compaction committed anything to
    // AgentHub (PR #87 review):
    //   - nothing committed (every attempt retryable/fatal/aborted): the fold
    //     never reached the model context — restore the prior carry-over **verbatim**. Zero
    //     committed attempts also means zero synthesized repairs, so there is no stash to
    //     interleave with (pinned by tests);
    //   - something committed: the carry-over is **consumed** — it lives in the committed
    //     history now and must never be resent; only the repair stash (unanswered tool_call
    //     pairing left by a final rejection, already in pendingCarryOver) remains pending.
    // Dead-goal rounds are downgraded on the drained snapshot (goal mode's consumer-site
    // rule): a no-commit restore keeps the downgraded copies — the downgrade is idempotent
    // and every consumer applies it anyway, while non-goal messages keep their identity.
    const folded = this.pendingCarryOver.map(downgradeCarriedGoalInput);
    this.pendingCarryOver = [];
    const result = yield* this.summarizeContext("manual", folded, opts?.signal);
    if (result.status === "completed") {
      this.pendingSummary = result.summary!;
    } else if (!result.committed) {
      this.pendingCarryOver = folded;
    }
    // committed but not completed: the carry-over is deliberately not restored.
  }

  /**
   * The wait the engine WILL apply before retrying this failure in-run, or undefined when
   * it won't (a non-retryable status, or `reconnectsSoFar` has reached `cap` — an abort
   * follows instead). Announced on the failure's `request_end` as `retry_in_ms` so the
   * frontend can render a live countdown; shares `reconnectDelayMs` with `backoff`, so the
   * announced wait and the actual sleep cannot drift. The caps differ by loop: the turn
   * loop passes `maxReconnects`, the compaction loop `compactionMaxReconnects`; `retries` must
   * match what the calling loop actually does, or the announced countdown is a lie.
   */
  private plannedRetryDelayMs(
    outcome: LLMOutcome,
    reconnectsSoFar: number,
    cap: number,
    retries: readonly StopReason[],
  ): number | undefined {
    if (!retries.includes(outcome.status)) return undefined;
    if (reconnectsSoFar >= cap) return undefined;
    return reconnectDelayMs(
      this.reconnectBackoffMs,
      this.reconnectBackoffMaxMs,
      reconnectsSoFar + 1,
    );
  }

  /** Resolves the in-progress backoff wait early ("retry now"); null when no wait is in progress. */
  private wakeBackoff: (() => void) | null = null;

  /**
   * Skips the in-progress reconnect backoff and fires the next retry immediately (the
   * user's "retry now" on the countdown): resolves the current wait as if its timer had
   * elapsed — the attempt counter is untouched, so the skipped wait never consumes an
   * extra attempt. Returns false (a benign no-op) when no reconnect wait is in progress;
   * idempotent under races — the wait settles exactly once whether the timer, a user
   * abort, or this skip lands first. Wakes whichever loop is waiting (the turn loop's
   * reconnect backoff, or a compaction retry's). Mirrors `steer` as the second
   * mid-run nudge hosts can reach through the Session.
   */
  skipReconnectWait(): boolean {
    const wake = this.wakeBackoff;
    if (!wake) return false;
    wake();
    return true;
  }

  /**
   * Exponential backoff before a reconnect retry (`reconnectDelayMs` of the configured
   * base/ceiling; attempt numbering starts at 1); returns false if the user interrupts
   * during the backoff — the abort listener also fires mid-wait, so even a 30s ceiling
   * wait hands control back immediately — letting the caller proceed to interruption
   * cleanup. A "retry now" skip (`skipReconnectWait`) resolves the wait early as true,
   * proceeding straight to the retry.
   */
  private backoff(attempt: number, signal?: AbortSignal): Promise<boolean> {
    const ms = reconnectDelayMs(this.reconnectBackoffMs, this.reconnectBackoffMaxMs, attempt);
    return new Promise<boolean>((resolve) => {
      if (signal?.aborted) {
        resolve(false);
        return;
      }
      // Settles exactly once: the timer, a user abort, and a "retry now" skip may race —
      // whichever lands first wins, the rest become no-ops (no double-fire).
      let settled = false;
      const settle = (proceed: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        this.wakeBackoff = null;
        resolve(proceed);
      };
      const onAbort = (): void => settle(false);
      const timer = setTimeout(() => settle(true), ms);
      signal?.addEventListener("abort", onAbort, { once: true });
      this.wakeBackoff = () => settle(true);
    });
  }

  /**
   * Runs one LLM turn: consumes the LLM stream, approving each complete tool_call immediately;
   * "allow" runs it concurrently (without blocking further stream consumption/approval), "deny"
   * feeds back an aborted output. partial/complete tool_call_output is yielded in completion
   * order. Returns all of this turn's tool outputs (for the next turn) and whether it was
   * interrupted midway.
   * Docs: /docs/agent-loop § "Lifecycle of a turn".
   */
  private async *runTurn(
    input: OmniMessage[],
    approve: ApproveFn,
    signal?: AbortSignal,
    thinkingLevel?: ThinkingLevelName,
    /** Retries already performed for this turn (from the caller's reconnect loop): lets request_end announce the NEXT attempt's planned backoff. */
    reconnectsSoFar = 0,
  ): AsyncGenerator<OmniMessage, TurnResult> {
    const queue = new MergeQueue();
    // Tool outputs are collected in **completion order** (for streaming yield to the frontend);
    // the tool_calls' **original order** is recorded separately, and reordered back to original
    // order when fed into the next LLM turn (async tool calls: feedback order is preserved).
    const toolOutputs: OmniMessage[] = [];
    const toolCalls: OmniMessage<ToolCallPayload>[] = [];
    const callOrder: string[] = [];
    // This turn's complete thinking/text segments produced by the model (including partial
    // segments finalized on interruption), for carry-over flatten.
    const assistantSegments: OmniMessage[] = [];
    // This turn's LLM terminal state: taken from streamGenerate's generator return value.
    let outcome: LLMOutcome = { status: "completed" };

    // Driver task: consumes the LLM stream + approves one at a time + dispatches tool
    // execution. It is itself a producer.
    queue.addProducer();
    const drive = (async () => {
      try {
        // Request boundary events (replayability): start is
        // emitted when the request is issued, stop carries the terminal state at completion —
        // replay mechanically determines from these whether the turn was committed by AgentHub.
        const startEvt = requestBegin();
        queue.push(startEvt);
        await this.write(startEvt);
        // Iterate manually to capture the generator's **return value** (LLMOutcome); LLM
        // guarantees it never throws.
        const gen = this.llm.streamGenerate({
          newMessages: input,
          ...(signal ? { signal } : {}),
          ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
        });
        for (;;) {
          const res = await gen.next();
          if (res.done) {
            outcome = res.value;
            // Non-completed outcomes carry the failure detail onto the event: a retried
            // request never produces an abort, so this is the only place observability
            // (the errors panel) can learn the real reason (e.g. a quota code). When the
            // engine will retry in-run, the planned backoff rides along as retry_in_ms
            // (the frontend's live countdown); absent on final failures and completions.
            const retryInMs = this.plannedRetryDelayMs(
              outcome,
              reconnectsSoFar,
              this.maxReconnects,
              RETRY_STATUSES,
            );
            const stopEvt = requestEnd(outcome.status, {
              ...(outcome.errorMessage !== undefined ? { errorMessage: outcome.errorMessage } : {}),
              // The authoritative attempt ordinal (1-based, within this retry run); a clean
              // first-try completion stays unstamped so the common case adds no noise.
              ...(outcome.status !== "completed" || reconnectsSoFar > 0
                ? { attempt: reconnectsSoFar + 1 }
                : {}),
              ...(retryInMs !== undefined ? { retryInMs } : {}),
            });
            queue.push(stopEvt);
            await this.write(stopEvt);
            break;
          }
          const msg = res.value;
          queue.push(msg);
          await this.write(msg);
          // token_usage means "this Request completed normally": record the context usage /
          // Session cumulative counts, and increment the Session turn count (counted per LLM
          // Request, across Tasks; used for compaction threshold checks).
          if (this.observeTokenUsage(msg)) this.sessionTurns += 1;
          // Collect complete thinking/text segments (including partial segments finalized on
          // interruption), for carry-over flatten.
          if (
            isCompleteModelMessage(msg) &&
            (msg.payload.type === "thinking" || msg.payload.type === "text")
          ) {
            assistantSegments.push(msg);
          }
          // Approve as soon as each real, complete tool_call finishes streaming. A tool_call
          // synthesized to close out an interruption carries a non-"completed" stop_reason (see
          // finishInterrupted): its arguments weren't fully emitted, and it exists only
          // for structural closure and observability — it isn't dispatched for execution, isn't
          // added to this turn's ledger, and gets no paired output backfilled: such a tool_call
          // was never committed to history by AgentHub, so there's nothing to pair. This turn
          // must then end with a non-completed outcome (only interruption closure produces such
          // a tool_call): a retryable outcome is cleaned up by
          // reconnect resending the flatten carry-over, while the run-ending ones
          // (aborted/fatal) exit directly.
          if (isCompleteModelMessage(msg) && msg.payload.type === "tool_call") {
            const tc = msg as OmniMessage<ToolCallPayload>;
            if (tc.payload.stop_reason !== "completed") continue;
            const toolCallId = tc.payload.tool_call_id;
            callOrder.push(toolCallId);
            toolCalls.push(tc);
            // Already interrupted: stop dispatching new tools, but keep consuming until the LLM
            // returns its outcome (the LLM will close out quickly and return aborted).
            if (signal?.aborted) continue;
            // The approval callback is injected externally (RunOptions.approve): any throw
            // collapses to deny (conservative), so the exception never escapes the engine —
            // otherwise it would propagate through session.run without building carry-over,
            // leaving the already-committed tool_use unanswered.
            let decision: ApprovalDecision;
            try {
              decision = await approve(tc);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              process.stderr.write(`[penguin] approve callback threw: ${message}; denying.\n`);
              decision = "deny";
            }
            if (signal?.aborted) continue;
            // approve is a callback; context_engine emits its decision as an approval_decision
            // OmniMessage: pushed to the stream for frontend rendering, and written to Trace.
            const decisionMsg = approvalDecision(decision, toolCallId);
            queue.push(decisionMsg);
            await this.write(decisionMsg);
            if (decision !== "allow") {
              // Denied: feed back an aborted output immediately, so the already-committed
              // tool_use never dangles. One fixed line either way — the wording names the
              // decider ("forbidden" is the command policy's answer, via the Session
              // wrapper), and the approval_decision event above carries the decision itself.
              const denied = toolCallOutput({
                output:
                  decision === "forbidden"
                    ? "Tool call denied by policy."
                    : "Tool call denied by user.",
                toolCallId,
                stopReason: "aborted",
              });
              queue.push(denied);
              await this.write(denied);
              toolOutputs.push(denied);
              continue;
            }
            // Approved: run concurrently, without blocking further consumption of the LLM
            // stream or approval of the next tool.
            queue.addProducer();
            void this.executeOne(tc, queue, toolOutputs, signal, approve).finally(() => {
              queue.removeProducer();
            });
          }
        }
      } finally {
        queue.removeProducer();
      }
    })();

    // Single consumer: yield merged messages one at a time until all producers are done and
    // the queue is drained.
    for (;;) {
      const msg = await queue.next();
      if (msg === null) break;
      yield msg;
    }
    // Wait for the driver task to fully finish (state settles).
    await drive;

    // Feed into the next turn: reordered to the original tool_call order (each tool_call has
    // exactly one output, see the executeOne invariant).
    const byId = new Map<string, OmniMessage>();
    for (const out of toolOutputs) {
      const id = (out.payload as { tool_call_id?: string }).tool_call_id;
      if (id !== undefined) byId.set(id, out);
    }
    const orderedOutputs: OmniMessage[] = [];
    const seen = new Set<string>();
    for (const id of callOrder) {
      if (seen.has(id)) continue; // Dedupe: feed back exactly one output per tool_call_id, to preserve pairing
      seen.add(id);
      const out = byId.get(id);
      if (out) orderedOutputs.push(out);
    }
    return { toolOutputs: orderedOutputs, toolCalls, assistantSegments, outcome };
  }

  /**
   * Executes a single approved tool: streams its partial/complete tool_call_output (through the
   * queue), and collects the complete tool_call_output into toolOutputs.
   *
   * Environment is contracted to handle all errors internally: it guarantees exactly one
   * complete `tool_call_output` to close out and never throws. But since
   * EnvironmentInterface can be injected by consumers via a public API, if a contract-violating
   * exception escapes, this fire-and-forget promise would take down the process with an
   * unhandled rejection, and the missing output would leave the already-committed tool_use
   * unanswered (the next request gets rejected by the provider) — so a boundary safety net is
   * kept here, collapsing a contract-violating exception into a failed output. This guarantees
   * exactly one complete output per tool enters toolOutputs, keeping tool_use and tool_result
   * paired.
   */
  private async executeOne(
    toolCall: OmniMessage<ToolCallPayload>,
    queue: MergeQueue,
    toolOutputs: OmniMessage[],
    signal?: AbortSignal,
    approve?: ApproveFn,
  ): Promise<void> {
    let completed = false;
    try {
      for await (const out of this.deps.environment.executeTool({
        toolCall,
        ...(signal ? { signal } : {}),
        // Pass through the parent approval callback: run_subagent uses this so the child
        // Session inherits the parent Agent's approval mode.
        ...(approve ? { approve } : {}),
      })) {
        queue.push(out);
        // Nested-session messages carrying an origin: forwarded to the frontend as a stream;
        // their content is not written to the parent Trace (the child Session has its own
        // Trace). When a direct child session's (origin length 1) session_meta arrives, write a
        // subagent pointer event to the parent Trace (recording only the child Session id), so
        // reopening the session can recursively expand child Traces — pointers for grandchild
        // sessions are recorded by the child Trace itself, so only depth 1 is recognized here.
        // Never fed back — a child session's tool_call_output has no pairing with the parent's
        // tool_call, and feeding it back by mistake would be rejected by the Provider.
        if (out.origin && out.origin.length > 0) {
          if (isSessionMeta(out) && out.origin.length === 1) {
            await this.write(subagentEvent(out.origin[0]!));
          }
          continue;
        }
        await this.write(out);
        if (isCompleteModelMessage(out) && out.payload.type === "tool_call_output") {
          toolOutputs.push(out);
          completed = true;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (completed) {
        // Thrown only after the complete output was ready: pairing is intact, so just warn.
        process.stderr.write(`[penguin] environment threw after tool output: ${message}\n`);
        return;
      }
      const failed = toolCallOutput({
        output: `[tool error] ${message}`,
        toolCallId: toolCall.payload.tool_call_id,
        stopReason: "fatal",
      });
      queue.push(failed);
      await this.write(failed);
      toolOutputs.push(failed);
    }
  }

  /** Max turns reached: emits a failed notice (streaming fragments + complete text) for CLI/frontend rendering. */
  private async *emitMaxTurns(): AsyncGenerator<OmniMessage> {
    // Reduce leading newlines: avoid stacking extra newlines before the text (comment #15).
    const text = `[reached max turns (${this.maxTurns}); stopping]`;
    const partials = [
      partialText("start"),
      partialText("delta", text),
      partialText("stop", "", "fatal"),
    ];
    for (const partial of partials) {
      yield partial;
      await this.write(partial);
    }
    const note = assistantText(text, "fatal");
    yield note;
    await this.write(note);
  }

  // -------------------------------------------------------------------------
  // Context compaction
  // -------------------------------------------------------------------------

  /**
   * Checks the compaction threshold: triggers once context usage (the most recent
   * token_usage's request.total) or the Session cumulative turn count **reaches** the threshold
   * (>=) — e.g. maxSessionTurns=1 compacts as soon as turn 1 completes, without waiting for the
   * next Task; when both are configured, either reaching its threshold triggers compaction.
   * Never triggers when compaction is not configured.
   * Docs: /docs/agent-loop § "Compaction".
   */
  private compactionTrigger(): CompactionReason | null {
    const settings = this.deps.compaction;
    if (!settings || !this.deps.createLLM) return null;
    if (settings.maxContextLength > 0 && this.lastRequestTotal >= settings.maxContextLength) {
      return "context";
    }
    if (settings.maxSessionTurns > 0 && this.sessionTurns >= settings.maxSessionTurns) {
      return "turns";
    }
    return null;
  }

  /** Records context usage and Session cumulative counts from a token_usage event; returns whether the message is a token_usage. */
  private observeTokenUsage(msg: OmniMessage): boolean {
    if (msg.type !== "event_msg") return false;
    const payload = msg.payload as Partial<TokenUsagePayload>;
    if (payload.type !== "token_usage") return false;
    if (payload.request) this.lastRequestTotal = payload.request.total;
    if (payload.session) this.lastSessionTokens = payload.session;
    return true;
  }

  /**
   * `discard` compaction: sends no compaction request, simply discards the old context —
   * swaps in a new LLM object and splits a new Trace file, with the next turn's input used
   * unchanged as the new object's first input. Only runs at a Task boundary (deferred by the
   * caller while mid-Task).
   */
  private async *discardContext(reason: CompactionReason): AsyncGenerator<OmniMessage> {
    yield* this.emitCompactionBegin(reason, "discard");
    yield* this.emitCompactionEnd(reason, "discard", "completed");
    await this.startNewContext();
  }

  /**
   * `summarize` compaction: appends the compaction Prompt to the **old** LLM object (first
   * folding in all of this turn's tool results when mid-Task, to keep tool_use/tool_result
   * pairing), then extracts the `[summary]` and wraps it as `[context_summary]` user text. The
   * compaction request carries the session's toolset **unchanged** — the request prefix must
   * stay byte-identical to ordinary turns so the provider's prompt cache remains valid;
   * compaction runs exactly when the context is largest, where re-billing the whole
   * transcript uncached costs tens of times more (issue #84 — this is why tools are *not*
   * omitted and no `tool_choice` override is used). The
   * compaction request's raw messages are not pushed to the Human output stream, with two
   * exceptions between the paired compaction events: every attempt's `token_usage` (so the
   * frontend stats and the server's usage records count the compaction's true spend,
   * rejected attempts included), and the summary text being generated, as ordinary
   * `partial_text`/`text` messages (issue #290 — see runCompactionRequest); everything is
   * written to the old Trace as before. Compaction succeeds only with a **valid summary** — non-empty extracted
   * text and no tool calls in the response. Everything short of that is one kind of failure,
   * handled exactly like an ordinary LLM request's (issue #170): an unusable committed
   * response (empty summary, or tool calls — answered with synthesized failed outputs and
   * retried behind a corrective note, see the loop body) and the retryable failures all
   * reconnect under the one `compactionMaxReconnects` budget
   * (defaulting to the turn loop's budget and ladder — see RETRY_STATUSES); only `fatal` stops
   * without retrying. Once the budget is exhausted the compaction fails; on failure/abort, the original
   * context and Trace index are kept — it does not fall back to discard. The first **committed**
   * attempt absorbs `pendingToolOutputs` into the old context's history (issue #85): later
   * resends carry only the repairs and the Prompt, and the result's `committed` flag tells
   * the caller the folded input must not be resent even though the compaction did not complete.
   * Docs: /docs/agent-loop § "Compaction".
   */
  private async *summarizeContext(
    reason: CompactionReason,
    pendingToolOutputs: OmniMessage[],
    signal?: AbortSignal,
  ): AsyncGenerator<OmniMessage, CompactionResult> {
    const settings = this.deps.compaction!;
    yield* this.emitCompactionBegin(reason, "summarize");

    // Compaction request input: this turn's tool results (mid-Task) or leftover interruption
    // carry-over, appended to the old object together with the compaction Prompt as one user
    // turn — keeping tool_use/tool_result pairing intact, since an unanswered tool_use would
    // get the compaction request itself rejected (issue #33). The compaction exchange is
    // written to the old Trace (traceable but not pushed to the user); tool results were
    // already written when executed and aren't recorded again, while carry-over's
    // not-yet-written synthetic content (flatten text, backfilled placeholders) and the
    // compaction Prompt are written now.
    const prompt = userText(settings.prompt);
    // The resend base: shrinks to the Prompt alone once an attempt commits — the folded turn
    // input then lives in the old LLM object's history, and resending it would make strict
    // providers reject the request over duplicate/stale tool_results (issue #85).
    let base = [...pendingToolOutputs, prompt];
    let input = base;
    await this.write(prompt);

    // Whether the folded input was absorbed into the old object's history — true once any
    // attempt was committed by AgentHub (only `completed` commits: a retryable failure ends
    // an incomplete stream, and fatal/aborted throw or cut off before a clean end — none of
    // those reach the stateful commit). Returned as
    // `committed`: the callers' two-case carry rule branches on it.
    let committed = false;
    // Synthesized outputs answering the latest unusable attempt's tool calls, not yet carried
    // by a committed request: prepended to the retry input, and stashed as carry-over should
    // the compaction be abandoned first (see stashRepairs).
    let pendingRepairs: OmniMessage[] = [];
    // One retry budget for every failure: an unusable committed response (empty summary /
    // tool calls) counts exactly like a retryable failure (issue #170) — same counter, same
    // exponential ladder — and only `fatal` stops without retrying.
    let reconnects = 0;
    // The compaction_end event's share of the RetryDetail block (also what the server's
    // error record carries): the final attempt ordinal, and the last failure's detail.
    let attempts = 0;
    let lastError: string | undefined;
    for (;;) {
      if (signal?.aborted) {
        this.stashRepairs(pendingRepairs);
        yield* this.emitCompactionEnd(
          reason,
          "summarize",
          "aborted",
          attempts > 0 ? { attempt: attempts } : undefined,
        );
        return { status: "aborted", committed };
      }
      const attempt = yield* this.runCompactionRequest(input, signal, reconnects);
      attempts += 1;
      // Every attempt's token_usage is pushed to the Human output stream (already written to
      // Trace in runCompactionRequest, so it's only yielded here, never rewritten): the frontend
      // stats and the server's usage records then carry the compaction's true spend — failed
      // attempts burn real tokens (issue #170), and surfacing only the adopted attempt's usage
      // understated the cost center.
      if (attempt.usage) yield attempt.usage;
      // A committed-but-unusable response (empty summary or tool calls): its retry input must
      // be rebuilt below — repairs + corrective note + Prompt — instead of resent unchanged.
      let unusable = false;
      if (attempt.status === "completed") {
        // The attempt was committed by AgentHub, so whatever its input carried — including
        // repairs synthesized for a previous rejection — is now in history and must not be
        // resent. The first commit absorbs the folded turn input: the base shrinks to the
        // Prompt alone.
        committed = true;
        base = [prompt];
        pendingRepairs = [];
        // A completed response counts as a compaction success only when it is a **usable
        // summary**: the extracted text is non-empty and the response called no tool. The
        // extraction itself stays lenient (output without a [summary] tag is used verbatim),
        // but committing an empty `[context_summary]` would discard the whole context and
        // lose the task state, and a tool-calling response is not a summary at all — with the
        // session's tools offered (prefix-cache invariant), a model deciding to use one is a
        // live possibility, not just a hallucination (issue #83).
        const summaryText = extractSummary(attempt.text);
        if (summaryText !== "" && attempt.toolCalls.length === 0) {
          const summary = userText(buildContextSummaryText(summaryText));
          yield* this.emitCompactionEnd(reason, "summarize", "completed", { attempt: attempts });
          await this.startNewContext();
          return { status: "completed", summary, committed };
        }
        // Not a summary — one more failed attempt, sharing the reconnect budget below. Tool
        // calls were never dispatched, yet the assistant turn holding them IS
        // committed on the live LLM object — leaving them unanswered would get every
        // subsequent request rejected by the provider (unanswered tool_use, issue #33): the
        // exact state this file's other safety nets exist to prevent. Answer each call with a
        // synthesized failed output (the same shape executeOne uses), written to Trace so
        // resume replays the identical pairing, and prepended to the retry input so the
        // provider sees tool_use/tool_result paired. The empty-text case needs no repair:
        // that committed turn is plain assistant text/thinking, and re-sending the compaction
        // Prompt on top of it is structurally sound.
        unusable = true;
        lastError =
          attempt.toolCalls.length > 0
            ? "the response called tools instead of writing a summary"
            : "the response contained no usable summary";
        pendingRepairs = attempt.toolCalls.map((tc) =>
          toolCallOutput({
            output: "[tool error] the compaction request expects a summary, not tool calls",
            toolCallId: tc.payload.tool_call_id,
            stopReason: "fatal",
          }),
        );
        for (const repair of pendingRepairs) await this.write(repair);
      } else if (attempt.status === "aborted") {
        this.stashRepairs(pendingRepairs);
        yield* this.emitCompactionEnd(reason, "summarize", "aborted", { attempt: attempts });
        return { status: "aborted", committed };
      } else if (attempt.status === "fatal") {
        // `fatal` never retries: a definitive rejection or a dead credential doesn't heal
        // on a ladder. The compaction ends `fatal` too — the next trigger will hit the
        // same wall until a config or credential change; the original context is kept and
        // the error detail rides the compaction_end for the host to surface.
        this.stashRepairs(pendingRepairs);
        yield* this.emitCompactionEnd(reason, "summarize", "fatal", {
          attempt: attempts,
          ...(attempt.errorMessage !== undefined ? { errorMessage: attempt.errorMessage } : {}),
        });
        return { status: "fatal", committed };
      } else {
        // Retryable failure: keep its detail as the last error of record.
        lastError = attempt.errorMessage;
      }
      // One failure path for everything else — unusable summaries and retryable failures
      // (never committed by AgentHub) — treated like an
      // ordinary LLM request's failures: the same budget (defaulting to the shared
      // maxReconnects, issue #170) and the same exponential ladder. An unusable attempt's
      // request_end carries status completed, for which no retry_in_ms is announced — the
      // backoff wait still happens.
      if (reconnects >= this.compactionMaxReconnects) {
        // Retries exhausted on retryable failures (transport faults and unusable
        // summaries alike): the compaction ends `retryable` — abandoned this time, and
        // the standing trigger makes it up at the next opportunity.
        this.stashRepairs(pendingRepairs);
        yield* this.emitCompactionEnd(reason, "summarize", "retryable", {
          attempt: attempts,
          ...(lastError !== undefined ? { errorMessage: lastError } : {}),
        });
        return { status: "retryable", committed };
      }
      reconnects += 1;
      const ok = await this.backoff(reconnects, signal);
      if (!ok) {
        this.stashRepairs(pendingRepairs);
        yield* this.emitCompactionEnd(reason, "summarize", "aborted", { attempt: attempts });
        return { status: "aborted", committed };
      }
      if (unusable) {
        // Rebuild from the (shrunken) base rather than appending: everything the unusable
        // attempt's input carried is committed — the live object's history can only grow, so
        // the retry appends the fresh repairs, a corrective note, and the Prompt. The note
        // (written to Trace like the Prompt, and only when a retry actually follows) is what
        // breaks the copy-my-own-mistake loop: the model's freshest example is its committed
        // bad output, and rewriting history to hide it would invalidate the provider's
        // prompt cache (issue #84) — correcting forward is the one cache-safe option
        // (issue #170). Retryable failures skip this: nothing was committed, so their input
        // is resent unchanged (any pending repairs included).
        const guidance = userText(SUMMARY_RETRY_GUIDANCE);
        await this.write(guidance);
        input = [...pendingRepairs, guidance, ...base];
      }
    }
  }

  /**
   * Holds synthesized repair outputs as carry-over when a summarize compaction is abandoned
   * (failed/aborted) while the latest rejected attempt's tool calls are still unanswered: the
   * next run's first request (or the next manual compaction, which folds carry-over in) sends
   * them ahead of everything else, completing the tool_use/tool_result pairing on the live
   * LLM object that the provider would otherwise reject every subsequent request over. The
   * repairs were already written to Trace at synthesis time, and carry-over is never re-written
   * to Trace at send time, so no duplicate Trace entries arise.
   */
  private stashRepairs(repairs: OmniMessage[]): void {
    if (repairs.length === 0) return;
    this.pendingCarryOver = [...repairs, ...this.pendingCarryOver];
  }

  /**
   * Issues one compaction request — an ordinary LLM Request through the same object and the
   * same frozen config as every other turn (the toolset is deliberately identical: a changed
   * tool list would change the request prefix and invalidate the provider's prompt cache at
   * the moment the context is largest, issue #84). Consumes the old LLM object's streamed
   * output; raw model messages are **not pushed to the Human output stream** (`token_usage`
   * is captured and handed back via the return value for summarizeContext to yield), with
   * one exception: the text being generated rides the stream as its own ordinary
   * `partial_text`/`text` messages (issue #290) so the frontend can show the summary while
   * it is written — readers already treat model messages between the paired compaction
   * events as compaction-internal, and history rebuild reads the identical text back from
   * the span's complete assistant messages. Complete
   * messages and events are written to the old Trace; complete text segments are collected as
   * the compaction output, and `toolCalls` collects the response's real tool requests (never
   * dispatched — summarizeContext rejects such a response as not-a-summary and answers each
   * call with a synthesized failed output).
   * Token usage is counted into the Session
   * cumulative totals (recorded via observeTokenUsage, for the new object to carry forward).
   */
  private async *runCompactionRequest(
    input: OmniMessage[],
    signal?: AbortSignal,
    /** Transport retries already performed by the compaction loop (its request_end announces the next planned backoff too). */
    reconnectsSoFar = 0,
  ): AsyncGenerator<
    OmniMessage,
    {
      status: StopReason;
      text: string;
      toolCalls: OmniMessage<ToolCallPayload>[];
      usage: OmniMessage | null;
      /** Error detail (LLMOutcome.errorMessage) on non-completed statuses — becomes compaction_end.error_message when this failure ends the compaction. */
      errorMessage?: string;
    }
  > {
    // The compaction request is itself an ordinary Request, emitting paired request events —
    // written to the (old) Trace only, not pushed to the stream, keeping the compaction process
    // invisible to Human.
    await this.write(requestBegin());
    const gen = this.llm.streamGenerate({
      newMessages: input,
      ...(signal ? { signal } : {}),
    });
    let text = "";
    const toolCalls: OmniMessage<ToolCallPayload>[] = [];
    let usage: OmniMessage | null = null;
    // Whether this attempt streamed any partial_text content: real LLM objects stream the
    // summary as partial fragments (forwarded verbatim), and the complete text message that
    // follows must then stay off the stream or consumers would see the content twice; an
    // implementation that yields only complete messages streams those instead.
    let sawPartialText = false;
    for (;;) {
      const res = await gen.next();
      if (res.done) {
        // Same failure-detail + planned-backoff pass-through as the turn loop's
        // request_end, under the compaction cap. Compaction request events are written to
        // the old Trace only (never streamed), so retry_in_ms lands in the Trace record —
        // no live countdown renders for compaction; the frontend only sees the
        // compaction event pair. A rejected summary ends `completed`, for which
        // plannedRetryDelayMs yields nothing — rejection resends are immediate (see
        // summarizeContext), so no wait is ever announced for them.
        const retryInMs = this.plannedRetryDelayMs(
          res.value,
          reconnectsSoFar,
          this.compactionMaxReconnects,
          RETRY_STATUSES,
        );
        await this.write(
          requestEnd(res.value.status, {
            ...(res.value.errorMessage !== undefined
              ? { errorMessage: res.value.errorMessage }
              : {}),
            // Same stamping rule as the turn loop; for compaction the ordinal counts every
            // retry kind (transport and unusable-summary alike share one budget).
            ...(res.value.status !== "completed" || reconnectsSoFar > 0
              ? { attempt: reconnectsSoFar + 1 }
              : {}),
            ...(retryInMs !== undefined ? { retryInMs } : {}),
          }),
        );
        return {
          status: res.value.status,
          text,
          toolCalls,
          usage,
          ...(res.value.errorMessage !== undefined ? { errorMessage: res.value.errorMessage } : {}),
        };
      }
      const msg = res.value;
      await this.write(msg);
      if (this.observeTokenUsage(msg)) usage = msg;
      // Streamed compaction progress (issue #290): the summary's own text rides the output
      // stream between the paired compaction events — partial_text fragments verbatim (all
      // three phases, so the server's live tail opens and closes its fragment and a join
      // mid-compaction is seeded with the accumulated prefix), or the complete text when no
      // partial carried content (implementations that yield only complete messages) — never
      // both, so consumers see each character once. The request's other raw messages
      // (thinking, the compaction Prompt, request events) stay Trace-only as before.
      // Rejected attempts stream too: the frontend shows whatever the compaction request is
      // really producing, and history rebuild reads the same text back from the span's
      // complete assistant messages.
      {
        const p = msg.payload as { type?: string; text?: string };
        if (p.type === "partial_text") {
          if (typeof p.text === "string" && p.text !== "") sawPartialText = true;
          yield msg;
        }
      }
      if (isCompleteModelMessage(msg)) {
        if (msg.payload.type === "text") {
          const body = (msg.payload as TextPayload).text;
          text += body;
          if (!sawPartialText && body !== "") yield msg;
        } else if (msg.payload.type === "tool_call") {
          // Same filter as the turn loop: a tool_call synthesized to close out an interruption
          // carries a non-completed stop_reason — it is structural closure, not a real request,
          // and gets no paired output.
          const tc = msg as OmniMessage<ToolCallPayload>;
          if (tc.payload.stop_reason === "completed") toolCalls.push(tc);
        }
      }
    }
  }

  /**
   * Opens a new model context after successful compaction: swaps in a new LLM object (carrying
   * forward the Session cumulative token counts), resets the Session turn count and context
   * usage counter. Trace **does not** split files immediately — that's deferred until the next
   * message that needs writing, when it rotates and opens with a session_meta (see `write`),
   * avoiding an empty file if no further messages follow the compaction.
   */
  private async startNewContext(): Promise<void> {
    this.pendingTraceRotation = true;
    this.llm = this.deps.createLLM!(this.lastSessionTokens);
    this.sessionTurns = 0;
    this.lastRequestTotal = 0;
    // Lets compactability() distinguish "just compacted" from "hasn't chatted yet" — both have
    // sessionTurns === 0, but they mean two completely different things to the user (being told
    // "no completed conversation turns yet" right after compacting is as good as saying nothing).
    this.fromCompaction = true;
  }

  /** Yields and records a compaction start event (carrying reason/mode/current context usage/Session cumulative turns). */
  private async *emitCompactionBegin(
    reason: CompactionReason,
    mode: CompactionMode,
  ): AsyncGenerator<OmniMessage> {
    const msg = compactionBegin({
      reason,
      mode,
      context: this.lastRequestTotal,
      turns: this.sessionTurns,
    });
    yield msg;
    await this.write(msg);
  }

  /** Yields and records a compaction stop event (carrying the result status — non-completed means compaction was abandoned — plus its share of the RetryDetail block: final attempt ordinal, and the last error detail on failures). */
  private async *emitCompactionEnd(
    reason: CompactionReason,
    mode: CompactionMode,
    status: StopReason,
    detail?: { attempt?: number; errorMessage?: string },
  ): AsyncGenerator<OmniMessage> {
    const msg = compactionEnd({ reason, mode, status, ...detail });
    yield msg;
    await this.write(msg);
  }

  /** Interruption: emits an abort event. Cleanup/resending is managed centrally by `run` via carry-over; the LLM history is never touched again. */
  private async *emitAbort(reason: string): AsyncGenerator<OmniMessage> {
    const msg = abortEvent(reason);
    yield msg;
    await this.write(msg);
  }

  /**
   * Builds the interruption resend content (carry-over, interruption cleanup)
   * based on the LLM's terminal state. Used only for the **exit** cleanup of the statuses that
   * end the run: `aborted` and `fatal` (a retried `retryable` does not reach here, and neither
   * does reconnect retry: retry input is assembled by withRetriedTurns, appending
   * `[turn_retried]` with the failed attempt's output, distinct from the user-interruption
   * `[turn_aborted]`):
   * - Model output completed (case A, outcome=completed): AgentHub already committed an
   *   assistant turn containing `tool_call`, so it can only be resent as a structured
   *   `tool_call_output` to pair with it (cannot flatten, or the already-committed tool_call
   *   would be left unanswered and rejected).
   * - Model output incomplete (case B): the `tool_call_output` in this turn's input (paired
   *   with the previous completed turn) is kept as-is; the text input and this turn's
   *   thinking/text/tool call/result are flattened into a single `[turn_aborted]` plain-text
   *   user message.
   * Docs: /docs/agent-loop § "Interruption and carry-over".
   */
  private buildCarryOver(attemptInput: OmniMessage[], turn: TurnResult): OmniMessage[] {
    if (turn.outcome.status === "completed") {
      // Case A: every **committed** tool_call must have a paired output. If execution was
      // interrupted and some tool_calls were committed but never dispatched/completed, backfill
      // an interrupted-state placeholder for each, avoiding an unanswered tool_use in the next
      // turn that the provider would reject.
      const haveIds = new Set(
        turn.toolOutputs.map((o) => (o.payload as { tool_call_id?: string }).tool_call_id),
      );
      const backfill = turn.toolCalls
        .filter((tc) => !haveIds.has(tc.payload.tool_call_id))
        .map((tc) =>
          toolCallOutput({
            output: "[interrupted: tool aborted by user]",
            toolCallId: tc.payload.tool_call_id,
            stopReason: "aborted",
          }),
        );
      // Placeholders are sent to the model only and not written to Trace (synthetic carry-over
      // isn't persisted); resumption replay re-synthesizes placeholders as needed to guarantee
      // pairing (pairing fallback). Real outputs were already
      // written when produced.
      return backfill.length ? [...turn.toolOutputs, ...backfill] : turn.toolOutputs;
    }
    return this.flattenCarryOver(
      attemptInput,
      turn.assistantSegments,
      turn.toolCalls,
      turn.toolOutputs,
    );
  }

  /**
   * Case B: flattens this attempt's input and its produced content into carry-over. Structured
   * `tool_call_output` in the input (paired with the previous completed turn) is kept as-is;
   * everything else (text input, model thinking/text, this attempt's tool calls/results) is
   * transcribed into a single `[turn_aborted]` plain-text user message (includes all
   * completed and incomplete messages, including partial thinking/text). If the input text is
   * itself already a `[turn_aborted]` block (from a previous attempt or a previous run's
   * carry-over), its content is unwrapped and merged in, keeping a single-level structure.
   *
   * TODO(multimodal): only text input is currently kept — `image_url` / `inline_data` input is
   * lost during flatten (the `[turn_aborted]` structure has no corresponding transcription yet);
   * multimodal carry-over support to be added later.
   */
  private flattenCarryOver(
    attemptInput: OmniMessage[],
    assistantSegments: OmniMessage[],
    toolCalls: OmniMessage<ToolCallPayload>[],
    toolOutputs: OmniMessage[],
  ): OmniMessage[] {
    const structured = attemptInput.filter(
      (m) => (m.payload as { type?: string }).type === "tool_call_output",
    );
    const textInputs = attemptInput.filter((m) => (m.payload as { type?: string }).type === "text");
    const flattened = userText(
      this.buildTurnAbortedText(textInputs, assistantSegments, toolCalls, toolOutputs),
    );
    // flatten is sent to the model only and not written to Trace (synthetic carry-over isn't
    // persisted): resumption replay resends the discarded turn's **original input** as-is
    // (best-effort), with no dependency on this synthetic message.
    return [...structured, flattened];
  }

  /** Transcribes the interrupted turn's input, model thinking/text, and tool calls/results into a single `[turn_aborted]` plain-text block. */
  private buildTurnAbortedText(
    textInputs: OmniMessage[],
    assistantSegments: OmniMessage[],
    toolCalls: OmniMessage<ToolCallPayload>[],
    toolOutputs: OmniMessage[],
  ): string {
    const lines: string[] = [];
    for (const m of textInputs) {
      const t = (m.payload as TextPayload).text;
      // If this text is itself already a synthetic block — a previous run's `[turn_aborted]`,
      // or this turn's reconnect-appended `[turn_retried]` — extract its inner lines and merge
      // them in directly, avoiding layered nesting / unbounded growth (keeping a single-level
      // structure).
      const inner = unwrapSyntheticBlock(t);
      if (inner !== null) {
        if (inner) lines.push(inner);
      } else {
        lines.push(transcribeUserInput(downgradeGoalInput(t)));
      }
    }
    lines.push(...transcribeTurnLines(assistantSegments, toolCalls, toolOutputs));
    return buildTurnAbortedBlock(lines);
  }

  /**
   * Assembles the reconnect retry input: the original input is kept as-is (structure and
   * multimodal content preserved), with a `[turn_retried]` text appended at the end carrying
   * each failed attempt's thinking/text and tool calls/results produced so far; if nothing has
   * been produced yet, it's just the original input. The synthetic message is sent to the model
   * only and not written to Trace (same rule as flatten carry-over).
   * Docs: /docs/agent-loop § "Automatic reconnect".
   */
  private withRetriedTurns(input: OmniMessage[], failedTurns: TurnResult[]): OmniMessage[] {
    const lines = failedTurns.flatMap((t) =>
      transcribeTurnLines(t.assistantSegments, t.toolCalls, t.toolOutputs),
    );
    if (lines.length === 0) return input;
    return [...input, userText(buildTurnRetriedBlock(lines))];
  }

  /**
   * Trace writes are **best-effort**: observability should never interrupt the ReAct
   * loop, so write failures only warn rather than throw. The first write after compaction first
   * performs the deferred Trace rotation: splitting the file and opening it with session_meta.
   */
  private async write(msg: OmniMessage): Promise<void> {
    if (!this.deps.trace) return;
    if (this.pendingTraceRotation) {
      this.pendingTraceRotation = false;
      try {
        if (this.deps.trace.rotate) await this.deps.trace.rotate();
        if (this.deps.sessionMeta) await this.deps.trace.write(this.deps.sessionMeta);
        if (this.deps.toolList) await this.deps.trace.write(this.deps.toolList);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[trace] rotate failed: ${message}\n`);
      }
    }
    try {
      await this.deps.trace.write(msg);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[trace] write failed: ${message}\n`);
    }
  }
}

/** Transcribes the model's produced thinking/text and tool calls/results into tagged lines (shared by `[turn_aborted]`/`[turn_retried]`). */
function transcribeTurnLines(
  assistantSegments: OmniMessage[],
  toolCalls: OmniMessage<ToolCallPayload>[],
  toolOutputs: OmniMessage[],
): string[] {
  const lines: string[] = [];
  // The model's produced thinking/text (including partial segments finalized on interruption),
  // written in production order.
  for (const seg of assistantSegments) {
    const p = seg.payload as { type?: string };
    if (p.type === "thinking") {
      lines.push(transcribeThinking((seg.payload as ThinkingPayload).thinking));
    } else if (p.type === "text") {
      lines.push(transcribeText((seg.payload as TextPayload).text));
    }
  }
  for (const tc of toolCalls) {
    const p = tc.payload;
    lines.push(transcribeToolCall(p.name, p.tool_call_id, p.arguments));
  }
  for (const out of toolOutputs) {
    const p = out.payload as ToolCallOutputPayload;
    lines.push(transcribeToolCallOutput(p.tool_call_id, p.stop_reason ?? "completed", p.output));
  }
  return lines;
}
