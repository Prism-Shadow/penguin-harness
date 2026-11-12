/**
 * context_engine — orchestrates the ReAct loop.
 *
 * context_engine only handles AMSP records, orchestrating the flow of events between the
 * Human, LLM, and Environment interfaces, and writes every observable action to Trace.
 * The initial version keeps a linear message history.
 *
 * Human is the SDK's input/output boundary: there is no "Human implementation/interface".
 * Input is the Prompt list passed to `run`, plus the abort signal `signal` and the
 * per-tool approval callback `approve` in `RunOptions`; output is the AmspRecord stream
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
 * (MMSP maintains the history); each turn the engine only hands it the "new" messages:
 * the user Prompt on the first turn, and the previous turn's tool_call_output afterward.
 */
import {
  abortEvent,
  approvalDecision,
  compactionBegin,
  compactionEnd,
  addTokenCounts,
  emptyTokenCounts,
  isCompleteModelMessage,
  isModelMessage,
  isSessionMeta,
  requestBegin,
  requestEnd,
  subagentEvent,
  toolCallOutput,
  userText,
} from "@prismshadow/amsp/records";
import { hasInputImages, replaceInputImages } from "./rejected-images.js";
import {
  CLOSED_LINE,
  EMPTY_LINE,
  REFUSED_NO_ROUND,
  TRUNCATED_LINE,
  roundLine,
} from "./compaction-lines.js";
import { buildCompactionHandoff, compactionCallLines, pickSalvage } from "./compaction-carry.js";
import type { SpanCall, SpanRequest } from "./compaction-carry.js";
import {
  SALVAGE_MIN_CHARS,
  buildContextSummaryText,
  buildTurnAbortedBlock,
  extractSummary,
  summaryInTags,
  buildTurnRetriedBlock,
  stripRequestErrorLines,
  transcribeRequestError,
  transcribeText,
  transcribeThinking,
  transcribeToolCall,
  transcribeToolCallOutput,
  transcribeUserInput,
  unwrapSyntheticBlock,
  userSteeringText,
} from "@prismshadow/amsp/markers";
import type {
  ErrorCode,
  ApprovalDecision,
  CompactionMode,
  CompactionReason,
  AmspRecord,
  StopReason,
  TextPayload,
  TextSender,
  ThinkingPayload,
  TokenCounts,
  TokenUsagePayload,
  ToolCallOutputPayload,
  ToolCallPayload,
} from "@prismshadow/amsp/records";
import type {
  RunCutoff,
  ApproveFn,
  PreToolUseFn,
  PreToolUseOutcome,
  UserPromptFn,
  UserPromptOutcome,
  EnvironmentInterface,
  LLMInterface,
  LLMOutcome,
  ThinkingLevelName,
} from "../interfaces/index.js";
import { DEFAULT_MAX_TURN_ATTEMPTS, isInterruptedToolCall } from "../interfaces/llm.js";
import { MergeQueue } from "../internal/merge-queue.js";

/** Trace sink: `write` a complete/event/meta message; `rotate` starts a new file (compaction splits files). */
export interface TraceSink {
  write(msg: AmspRecord): Promise<void>;
  /** Optional: start a new Trace file (index+1), used to record the new model context after compaction. */
  rotate?(): Promise<void>;
  /** Optional: absolute path of the file the next `write` lands in (what stop hooks read the conversation from). */
  currentPath?(): string;
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
  /**
   * Tool rounds a summarize compaction may take before its summary (see
   * ContextEngineDeps.compactionToolGate): the harness counts them, and while one is open a
   * response's tool calls are answered and their outputs sent as the next request, behind a
   * line naming the rounds used and left. Absent or <= 0 (or no gate): none — every tool call
   * is refused.
   */
  maxRounds?: number;
  /**
   * No tool round is open once the context reaches this many tokens (the window minus the
   * room the summary still needs); resolved by the composition layer. Absent: no limit.
   */
  roundLimit?: number;
}

/**
 * What the gate answers for one tool call of a compaction tool round: allowed — it goes on to
 * the approval callback and the Environment like any call — or refused, with the reason the
 * model reads in its `[tool error]` output.
 */
export type CompactionToolVerdict = { allow: true } | { allow: false; reason: string };

/** Decides which tool calls a compaction tool round may run (see ContextEngineDeps.compactionToolGate). */
export type CompactionToolGate = (toolCall: AmspRecord<ToolCallPayload>) => CompactionToolVerdict;

/**
 * A model context opened by {@link ContextEngineDeps.openNextContext} after a completed compaction:
 * the fresh LLM object, plus what the opener re-read for it — the `session_meta` the rotated
 * Trace file opens with (so that file's head describes the context it records) and the
 * per-context engine settings. Every optional field absent means "the previous context's
 * stays": an opener that could not re-read the Agent State returns the LLM alone.
 */
export interface OpenedContext {
  llm: LLMInterface;
  sessionMeta?: AmspRecord;
  /** Maximum LLM turns per Task in this context; -1 removes the cap. */
  maxTurns?: number;
  /** Compaction settings of this context (thresholds, mode, Prompt). */
  compaction?: CompactionSettings;
  /**
   * Set when the opener could not assemble the Agent State and reopened the configuration in
   * force instead; the text is told to the model in the context's opening summary.
   */
  notice?: string;
}

/** What {@link ContextEngineDeps.openNextContext} is called with. */
export interface OpenContextOptions {
  /**
   * Publishes a record the opener produces while opening — the `mcp_connect_begin` /
   * `mcp_connect_end` pair bracketing its MCP connect, and the `tool_list_ready` carrying the
   * context's toolset. The engine holds them until the context is open — a compaction is
   * declared complete only then — and yields them in call order right after the
   * `compaction_end`; it writes them at the head of the rotated Trace file right after the
   * context's `session_meta`, so the new file is self-contained. An opener that emits nothing
   * leaves the previous context's toolset record in place there.
   */
  emit: (msg: AmspRecord) => void;
}

/**
 * How a summarize compaction ended: `completed` — the next context is open and starts with
 * `opening` (a summary, a salvaged summary or a hand-off note); `aborted` — the user stopped
 * it; `fatal` — no next context could be opened. Only `completed` replaces the context.
 */
type CompactionResult =
  | {
      status: "completed";
      /** The next context's first input: one user text, carried as a summary is. */
      opening: AmspRecord;
      /** Text input the compaction held and did not absorb (a hand-off absorbs nothing): it rides on behind `opening`. */
      residual: AmspRecord[];
    }
  | {
      status: "aborted" | "fatal";
      /**
       * What the kept context is still owed, which every caller holds as its carry-over (issue
       * #85): the folded input when no compaction response was committed (only a `completed`
       * request commits), else the outputs answering the latest committed response's calls —
       * the folded input then lives in the old LLM object's history and must never be resent,
       * since strict providers reject the duplicates as stale tool_results.
       */
      pending: AmspRecord[];
      /** Why the next context could not be opened (`fatal`). */
      errorMessage?: string;
    };

/** A context `openNextContext` opened and the records it published, not adopted yet. */
interface OpenedNext {
  opened: OpenedContext;
  records: AmspRecord[];
}

/** Responses that advanced nothing and are answered with a corrective line, per compaction. */
const MAX_COMPACTION_CORRECTIONS = 2;

/**
 * Options for `run`.
 * Docs: /docs/agent-loop § "Inputs and outputs".
 */
export interface RunOptions {
  /** Abort signal (e.g. Ctrl-C). */
  signal?: AbortSignal;
  /** Per-tool approval callback; defaults to denying everything (conservative, to avoid accidental approval when unattended). */
  approve?: ApproveFn;
  /** Pre-tool-use hook consult, called before `approve` for each complete tool_call; its events are recorded on the stream, its decision applied (see {@link PreToolUseFn}). */
  preToolUse?: PreToolUseFn;
  /** User-prompt hook consult, called once with this call's Prompt after it is written and before the first request — never for a call with no new input, which has no Prompt; its records follow the Prompt on the stream and in the Trace, and the user texts among them join the request input (see {@link UserPromptFn}). */
  userPrompt?: UserPromptFn;
}

/**
 * Engine initial state (used for Session resumption): derived by replaying Trace, so the
 * resumed engine behaves the same as before the process
 * exited. Not passed when creating a normal new Session.
 */
export interface EngineInitialState {
  /** Pending input (carry-over): resent alongside new input on the first `run` after resumption (synthetic placeholders exist only in memory, never written to Trace). */
  carryOver?: AmspRecord[];
  /** Summary recovered from a completed summarize compaction: used as the prefix of the next `run` input (merged with the user Prompt). */
  pendingSummary?: AmspRecord;
  /** The summary (or a model switch's handoff) the resumed context opened with, when it is already on the context's own file and no turn has completed since (see ResumeResult.openingSummary). */
  openingSummary?: AmspRecord;
  /** Carried-over Session cumulative turn count. */
  sessionTurns?: number;
  /**
   * The resumed context was opened by a **completed** compaction (the Trace's last record is a
   * completed `compaction_end`), so it is legitimately empty. Restores `fromCompaction`, which
   * is what keeps `compactability()` answering "just compacted" rather than "nothing said yet"
   * after a restart — both have zero turns and are not the same message to a user.
   */
  fromCompaction?: boolean;
  /** Carried-over Session cumulative token counts (the engine resumes its own accumulator from them). */
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
  /** Maximum LLM turns for a single Task in the first context; -1 removes the cap. Omitted means -1 too — the agent-config default and the SDK fallback agree (unlimited). A context `openNextContext` opens may bring its own. */
  maxTurns?: number;
  /**
   * Maximum automatic retries for LLM timeout/reconnect within a single run. Defaults
   * to 5: with the default backoff (2s base, 30s ceiling) that is 2+4+8+16+30 ≈ 60s of
   * total patience — transient provider failures (restarts, rate limits) get a real
   * recovery window instead of five retries burning out in about a second (issue #218).
   */
  maxReconnects?: number;
  /**
   * Absolute ceiling on the attempts a single turn may make, counting every attempt whether
   * or not it received anything. Defaults to `DEFAULT_MAX_TURN_ATTEMPTS`. It only binds once
   * received content has reset the consecutive ladder (`maxReconnects`) at least once, and
   * exists to keep that reset from turning an endpoint that streams a few tokens and drops — or
   * a response that keeps stopping at its output cap, each attempt billed in full — into a long
   * retry loop. The compaction loop does not use it: its requests run on
   * `compactionMaxReconnects` alone.
   */
  maxTurnAttempts?: number;
  /**
   * Exponential backoff base (ms): the wait before reconnect retry N is
   * `base × 2^(N−1)`, capped at `reconnectBackoffMaxMs` (see reconnectDelayMs).
   * Defaults to 2000.
   */
  reconnectBackoffMs?: number;
  /** Ceiling (ms) for a single reconnect backoff wait. Defaults to 30000. */
  reconnectBackoffMaxMs?: number;
  /**
   * Transport-class retries of a summarize compaction's requests, counted across the whole
   * compaction on the turn loop's backoff ladder. A response that advanced nothing (no summary,
   * tool calls with no round open, or one cut at the output limit) is a correction instead,
   * on a budget of its own, and `fatal` is not retried. Defaults to the shared
   * `maxReconnects`: a compaction request is an ordinary LLM request and deserves the same
   * patience (issue #170). Once a budget is spent the compaction still completes, from a
   * salvaged summary or a hand-off note.
   */
  compactionMaxReconnects?: number;
  /**
   * Opens a fresh model context after compaction: the new LLM object, plus whatever the
   * opener re-read for the new context — its session_meta and its engine settings (see
   * {@link OpenedContext}) — and, through `opts.emit`, the records it produced while opening
   * (see {@link OpenContextOptions}). May rebuild the toolset and connect MCP servers, hence
   * possibly async and possibly slow; the engine yields the emitted records live meanwhile.
   * Session token continuity is the engine's own bookkeeping — it seeds the returned LLM's
   * `sessionTokens` itself. Context compaction is unavailable if this is not provided.
   */
  openNextContext?: (opts: OpenContextOptions) => OpenedContext | Promise<OpenedContext>;
  /** The first context's compaction settings; only takes effect if provided together with `openNextContext`. A context `openNextContext` opens may bring its own. */
  compaction?: CompactionSettings;
  /**
   * Which tool calls a summarize compaction's tool rounds may run (see
   * CompactionSettings.maxRounds). The engine knows no tool by name: it asks this gate for each
   * call of a round, and a call the gate allows goes on to the approval callback and the
   * Environment exactly as a turn's would; a refused one is answered with a `fatal`
   * `[tool error] <reason>` output. The composition layer decides what "allowed" means (the
   * Agent allows `read_file`, and `write_file` / `edit_file` inside the Session's scratchpad).
   * A gate that throws refuses the call with its message. Absent: no round is open, and every
   * tool call in a compaction response is refused.
   */
  compactionToolGate?: CompactionToolGate;
  /**
   * Builds the hand-off note a compaction opens the next context with when no summary could be
   * had: a user text record the composition layer derives from the Trace file being closed.
   * Absent or throwing, the engine writes a bare note of its own.
   */
  buildHandoff?: () => AmspRecord | Promise<AmspRecord>;
  /**
   * The shell the Session's commands run in (the system prompt's `Shell:` value), used only to
   * word the Trace-query hint in the `[context_summary]` trailer for that shell. Absent: the
   * hint names the POSIX and PowerShell forms side by side.
   */
  shell?: string;
  /**
   * Live compaction settings, re-read at every point the engine consults them for a decision:
   * the post-request checkpoint (threshold and turn count), and the start of a compaction
   * (mode and prompt). This is what takes compaction configuration out of the strict tier —
   * an edit saved to the Agent's config reaches a running Session at its next checkpoint
   * instead of waiting for a rotation.
   *
   * Refreshes an existing baseline; it never creates one. An embedder that supplies only
   * `compaction` keeps today's fixed-per-context behaviour, and one that supplies neither has
   * no compaction at all — so whether compaction is *configured* stays a constant of the
   * Session, which is what `compactability()` may answer synchronously.
   *
   * The provider is expected to be cheap enough to call once per checkpoint (the Agent's caches
   * by the config file's identity on disk). A read that throws leaves the previous settings in
   * force and is logged once: a config file that briefly cannot be read must not end a run.
   */
  readCompaction?: () => CompactionSettings | Promise<CompactionSettings>;
  /**
   * The first context's session_meta message: written at the start of each Trace file a
   * compaction's rotation opens, until an `openNextContext` result brings the meta of the context
   * it opened — from then on that one is written, so every file's head describes its own
   * context.
   */
  sessionMeta?: AmspRecord;
  /**
   * The first context's tool_list_ready event (the resolved toolset). Written once right
   * after the first run's input (following `bootstrapRecords`), and again right after
   * sessionMeta on each Trace file a compaction's rotation opens — until an `openNextContext`
   * emits the records of the context it opened, which take its place there — so every
   * file's tool record stays self-contained. Held here alone; deliberately NOT part of
   * `bootstrapRecords`, so the one message isn't carried twice.
   */
  toolList?: AmspRecord;
  /**
   * The first run's mcp_connect begin/end pair (empty without MCP), written once right
   * AFTER that run's input messages — followed by `toolList` — so the connect phase lands
   * inside the new turn in the Trace, after the user's message (their timestamps precede
   * the write; the file stays chronologically consistent because the input message was
   * created before the connect began). Streaming already yielded them live before the
   * engine existed. Present (possibly empty) marks "first-run records still owed". Owed
   * only while the first context runs: when that context is replaced before any run wrote
   * them (a compaction or a model switch on a Session just resumed, whose engine was built
   * outside a run), they are dropped with it — and the first-run write of `toolList` with
   * them — rather than landing behind the next run's input, in the next context's file.
   */
  bootstrapRecords?: AmspRecord[];
  /**
   * Input adapter for a session whose model has no vision: folds image messages into text
   * lines appended to the input's user text. Absent = the model takes images directly. `run`'s
   * Prompt is folded by the caller before it reaches the engine; this hook exists for the one
   * input the engine assembles itself — steering (see `steeringMessages`). A `null` answer
   * leaves the input as it is too: the caller's model can change between contexts (a model
   * switch), and only the caller knows whether the one running now takes images.
   *
   * Expected to settle rather than reject: it runs mid-Task, and Session's binding already
   * degrades a failure into text saying the images were dropped.
   */
  foldInputImages?: (messages: AmspRecord[]) => Promise<AmspRecord[] | null>;
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
  backgroundNotices?: { drain(): AmspRecord[]; pending(): number };
}

const isImageMessage = (m: AmspRecord): boolean =>
  (m.payload as { type?: string }).type === "image_url";

const isTextMessage = (m: AmspRecord): boolean => (m.payload as { type?: string }).type === "text";

/** Whether a message carries steering of its own — an image, or text that isn't blank. */
const carriesSteering = (m: AmspRecord): boolean => {
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

/** Result of executing one LLM turn (the return value of runTurn). */
interface TurnResult {
  /** All tool outputs for this turn, reordered to match the original tool_call order (for the next turn's LLM input). */
  toolOutputs: AmspRecord[];
  /** tool_calls issued by the model this turn (in original order, real requests only). */
  toolCalls: AmspRecord<ToolCallPayload>[];
  /** Complete thinking/text segments produced by the model this turn (including partial segments finalized on interruption), for carry-over flattening. */
  assistantSegments: AmspRecord[];
  /**
   * Whether this attempt received anything at all from the LLM stream. It is what the
   * reconnect loop resets its ladder on: one message is proof the connection was established
   * and the model was producing. Deliberately wider than the collected arrays — a drop
   * mid-tool-call synthesizes a tool_call that is never dispatched and so never reaches
   * `toolCalls`, yet those bytes did arrive.
   */
  receivedContent: boolean;
  /** Terminal state of this turn's LLM request (completed / failed / aborted / timeout / malformed). */
  outcome: LLMOutcome;
}

/**
 * A turn's retry bookkeeping, threaded into `runTurn` so its `request_end` can announce the
 * next attempt's planned backoff. `attempts` counts every attempt the turn has made so far
 * (the ordinal hosts render, and what the absolute ceiling measures); `consecutive` counts
 * only the tail of them that came back having received nothing — the backoff rung, and what
 * `maxReconnects` measures. The two diverge as soon as an attempt receives content: see the
 * reconnect loop in runToCompletion.
 */
interface TurnRetryState {
  attempts: number;
  consecutive: number;
}

/**
 * LLM outcomes that reconnect in-run: exactly `retryable`. The classification lives in the LLM
 * interface (see LLMOutcome) — transport drops, timeouts, 408/429/5xx, malformed responses, a
 * response cut off at its output cap (`output_truncated`) and everything unclassifiable come
 * back `retryable`, while definitive provider rejections and credential failures come back
 * `fatal` and the turn loop aborts on them before consulting this set.
 *
 * Both loops retry the same set on the same backoff ladder, and by default with the same
 * budget: compaction runs on `compactionMaxReconnects`, which follows `maxReconnects` unless
 * set explicitly (issue #170 — a compaction request is an ordinary LLM request and gets the
 * turn loop's patience). Compaction takes one cause out of it: a response cut at its output
 * cap (`output_truncated`) is a correction there, asked again at once (see summarizeContext).
 *
 * One rule is the turn loop's alone: received content resets its ladder. A compaction's
 * ladder spans the whole compaction and never resets: it is bounded so that a provider which
 * cannot produce the summary hands over to the salvage and the hand-off note in bounded time.
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
  /** Per-context settings: the first context's from the deps, then whatever each opened context brings (see `adoptContext`). */
  private maxTurns: number;
  /** Compaction settings in force. Baseline per context (deps, then each opened context), and re-read from `deps.readCompaction` at every checkpoint in between. */
  private compaction: CompactionSettings | undefined;
  /** Whether a `readCompaction` failure has already been reported; one line per Session, not one per checkpoint. */
  private compactionReadWarned = false;
  private readonly maxReconnects: number;
  private readonly maxTurnAttempts: number;
  private readonly reconnectBackoffMs: number;
  private readonly reconnectBackoffMaxMs: number;
  private readonly compactionMaxReconnects: number;
  /** Interruption cleanup: content to resend generated when the previous run was aborted, held on the engine across runs. */
  private pendingCarryOver: AmspRecord[] = [];
  /** Current LLM object; swapped for the one `openNextContext` returns after a successful compaction (a fresh model context). */
  private llm: LLMInterface;
  /**
   * session_meta of the current context, written at the head of the Trace file the deferred
   * rotation opens (see `write`): the first context's at construction, then whatever meta each
   * `openNextContext` result brings — a context that brought none keeps the previous one.
   */
  private contextMeta: AmspRecord | undefined;
  /**
   * The records written right after `contextMeta` at that rotation — the context's toolset
   * record and, when it connected MCP servers, the connect pair before it: the first context's
   * `toolList` at construction, then what each `openNextContext` emitted — a context that emitted
   * nothing keeps the previous records.
   */
  private contextRecords: AmspRecord[];
  /** Session cumulative turn count: counted per LLM Request that produces token_usage, across Tasks; reset to zero after compaction completes. */
  private sessionTurns = 0;
  /** Whether the current context was produced by a compaction (`adoptContext`); this flag becomes meaningless once a new completed turn occurs. */
  private fromCompaction = false;
  /**
   * The Session's thinking-level pin — the soft-limited runtime parameter as engine-owned
   * state: `setThinkingLevel` (fed by the `Session.thinkingLevel` setter) moves it mid-context.
   * Undefined = no pin: the LLM object's construction default (the context's opening base)
   * applies. Each request — a turn and a compaction alike — goes out at the effective level
   * (`effectiveThinkingLevel`: this pin, else that default), and its `request_begin` records it.
   */
  private thinkingLevel?: ThinkingLevelName;
  /** Most recent token_usage's request.total, i.e. the current context usage figure. */
  private lastRequestTotal = 0;
  /** The Session-cumulative token series — engine-owned: accumulated from each token_usage's request counts and stamped onto the message before it is yielded or written (the LLM's lifetime is one context; the engine's is the Session). */
  private lastSessionTokens: TokenCounts = emptyTokenCounts();
  /** Summary produced by a Task-boundary compaction: used as the prefix of the next `run` input (merged with the next user Prompt). */
  private pendingSummary: AmspRecord | null = null;
  /**
   * The summary (or a model switch's handoff) the running context opened with, until a turn
   * completes on it: the only record of the conversation before the rotation, so a model switch
   * away from such a context writes it at the head of the next context's file.
   */
  private openingSummary: AmspRecord | null = null;
  /** Bootstrap records still owed to the Trace (written after the first run's input); see ContextEngineDeps.bootstrapRecords. */
  private pendingBootstrapRecords: AmspRecord[] | null = null;
  /**
   * Set to true once compaction completes: Trace rotation is deferred until the next
   * message that needs writing (see `write`) — so that if no further messages follow the
   * compaction, we don't create an empty file containing only session_meta. A model switch is
   * the one exception: it performs the rotation at once (see `switchContext`). Whoever opens
   * the file streams its session_meta (see `openPendingContext`).
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
  private steeringQueue: AmspRecord[][] = [];
  /** Whether a `run` is currently in flight (gates `steer`; compaction does not count). */
  private taskRunning = false;

  /** Whether a `run` is in flight (the Session's notice routing keys on this: a running task delivers notices at the next boundary; an idle one goes through the host). */
  get isTaskRunning(): boolean {
    return this.taskRunning;
  }

  /**
   * Whether a run with no new input would still send something: the carry-over a failed or
   * interrupted run left behind, or a Task-boundary compaction's summary waiting to lead the
   * next request. A host's Retry of a failed or interrupted run is exactly such a run, so this
   * is what it checks before starting one.
   */
  hasPendingInput(): boolean {
    return this.pendingCarryOver.length > 0 || this.pendingSummary !== null;
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
  private async *deliverBackgroundNotices(): AsyncGenerator<AmspRecord, AmspRecord[]> {
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
    this.maxTurnAttempts = deps.maxTurnAttempts ?? DEFAULT_MAX_TURN_ATTEMPTS;
    this.reconnectBackoffMs = deps.reconnectBackoffMs ?? 2000;
    this.reconnectBackoffMaxMs = deps.reconnectBackoffMaxMs ?? 30_000;
    this.compactionMaxReconnects = deps.compactionMaxReconnects ?? this.maxReconnects;
    this.compaction = deps.compaction;
    this.llm = deps.llm;
    this.contextMeta = deps.sessionMeta;
    this.contextRecords = deps.toolList ? [deps.toolList] : [];
    // Session resumption: apply the initial state derived from replay.
    const init = deps.initialState;
    if (init) {
      this.pendingCarryOver = init.carryOver ?? [];
      this.pendingSummary = init.pendingSummary ?? null;
      // A resumed context that has not completed a turn still opens with its summary: the one
      // already on its own file, or the one a closed file left pending.
      this.openingSummary = init.openingSummary ?? this.pendingSummary;
      this.sessionTurns = init.sessionTurns ?? 0;
      this.fromCompaction = init.fromCompaction ?? false;
      this.lastSessionTokens = init.sessionTokens ?? emptyTokenCounts();
      this.lastRequestTotal = init.lastRequestTotal ?? 0;
      this.pendingTraceRotation = init.pendingTraceRotation ?? false;
    }
  }

  /** Moves the Session's thinking level mid-context (see the `thinkingLevel` field); applies from the next request, turn or compaction. */
  setThinkingLevel(level: ThinkingLevelName): void {
    this.thinkingLevel = level;
  }

  /**
   * The level the next request goes out at: the pin, else the LLM object's construction
   * default. Resolved here, once per request, so the value written on `request_begin` is the
   * value handed to the LLM; undefined when neither exists (no level is sent).
   */
  private effectiveThinkingLevel(): ThinkingLevelName | undefined {
    return this.thinkingLevel ?? this.llm.defaultThinkingLevel;
  }

  /**
   * Runs a Task to completion, streaming out AmspRecord. `newMessages` is this call's
   * Prompt (only the newly added input, not the full history — history is maintained by the
   * stateful GenerativeModel); `opts.signal` is the abort signal, `opts.approve` is the
   * per-tool approval callback. An empty `newMessages` sends only what is held (see
   * `hasPendingInput`) — a Retry of a failed or interrupted run — and returns null at once
   * when nothing is.
   * Docs: /docs/agent-loop § "The loop at a glance".
   */
  async *run(
    newMessages: AmspRecord[],
    opts?: RunOptions,
  ): AsyncGenerator<AmspRecord, RunCutoff | null> {
    // Steering window: only while this generator is being driven. The finally also covers
    // abort/failure exits — anything still queued is discarded (see steeringQueue).
    this.taskRunning = true;
    try {
      // The return value says how the run ended (yield* propagates it): null = ran to
      // completion; a RunCutoff = ended early, with the terminal record's error pair.
      return yield* this.runToCompletion(newMessages, opts);
    } finally {
      this.taskRunning = false;
      this.steeringQueue = [];
    }
  }

  /**
   * Queues a steering message for the running Task: it is delivered with the next request
   * input as a standalone `[user_steering]` user message — alongside that turn's tool
   * outputs, or alone as the continuation input when the turn produced no tool calls.
   * `input` is an AmspRecord list, the shape `run` takes a Prompt in: its user text becomes
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
  steer(input: AmspRecord[]): boolean {
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
  unsteer(input: AmspRecord[]): boolean {
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
  private async *deliverSteering(): AsyncGenerator<AmspRecord, AmspRecord[]> {
    if (this.steeringQueue.length === 0) return [];
    const drained = this.steeringQueue;
    this.steeringQueue = [];
    const messages: AmspRecord[] = [];
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
  private async steeringMessages(input: AmspRecord[]): Promise<AmspRecord[]> {
    // No images, no fold: an image-free steering message is the same message either way.
    const folded = input.some(isImageMessage) ? await this.deps.foldInputImages?.(input) : null;
    const messages = folded ?? input;
    const texts: string[] = [];
    // The delivered [user_steering] message keeps the queued input's sender: a parent agent
    // steering its child (input_subagent) records as "parent_agent" in the child's Trace,
    // while human steering keeps the field absent — origin stays a structural fact.
    let sender: TextSender | undefined;
    const rest: AmspRecord[] = [];
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
    if (folded && (rest.some(isImageMessage) || texts.length === 0)) {
      throw new Error("foldInputImages must return the input's images folded into a user text.");
    }
    return [userText(userSteeringText(texts.join("\n\n")), sender), ...rest];
  }

  /** The actual Task loop behind `run` (split out so run's finally can close the steering window on every exit path). */
  private async *runToCompletion(
    newMessages: AmspRecord[],
    opts?: RunOptions,
  ): AsyncGenerator<AmspRecord, RunCutoff | null> {
    const signal = opts?.signal;
    // Default approval policy: deny (conservative). CLI/Web will inject a real callback (interactive or permission-mode based).
    const approve: ApproveFn = opts?.approve ?? (async () => "deny");
    const preToolUse = opts?.preToolUse;

    // Merge the Task-boundary compaction summary (the new context's first input, merged with
    // this Prompt), the carry-over left over from the last interruption, and this call's new
    // input, to form this Request's input.
    const summary = this.pendingSummary;
    this.pendingSummary = null;
    const carryOver = this.pendingCarryOver;
    this.pendingCarryOver = [];
    const prefix = summary ? [summary, ...carryOver] : carryOver;
    let input = prefix.length ? [...prefix, ...newMessages] : newMessages;
    // A run with no Prompt of its own (a host's Retry of a failed or interrupted run) sends what
    // is held. With nothing held either — no summary, no carry-over, no background notice to
    // ride the first request — there is no request to make: end here, before anything is
    // written, rather than send the provider an empty input. Hosts ask `hasPendingInput` first;
    // this is the backstop.
    if (input.length === 0 && this.pendingNoticeCount() === 0) return null;

    // Input is written to Trace (Prompt record, incl. audit trail) but not replayed to
    // the render layer. carry-over is not written to Trace: real messages (tool outputs etc.)
    // are already written when produced; synthetic content (flatten text, backfilled
    // placeholders) is **sent to the model only, never persisted** — Trace records only real
    // messages, and resumption replay best-effort reconstructs from original messages.
    // Exception: the compaction summary, which is the new
    // context's first input record, is written as usual.
    // The first write after a compaction opens the new context's file: its session_meta
    // streams here, ahead of the input the host echoes, in the order the Trace has them.
    yield* this.openPendingContext();
    if (summary) await this.write(summary);
    for (const msg of newMessages) await this.write(msg);
    // User-prompt hooks (RunOptions.userPrompt, wired by the Session from the Agent's
    // installed hook packages): consulted once per Prompt, here, so what they answer lands
    // right behind the user's message — on the stream, in the Trace and in the request
    // input alike. A throw collapses to nothing to add: a broken hook must not cost the
    // user their Prompt. A call with no new input has no Prompt to consult on: a retry
    // resends a turn whose own Prompt was consulted when it was first sent.
    if (opts?.userPrompt && newMessages.length > 0 && !signal?.aborted) {
      let expanded: UserPromptOutcome | null = null;
      try {
        expanded = await opts.userPrompt(newMessages, signal);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[penguin] userPrompt consult threw: ${message}; ignoring.\n`);
      }
      const contexts: AmspRecord[] = [];
      for (const record of expanded?.records ?? []) {
        yield record;
        await this.write(record);
        if (isModelMessage(record)) contexts.push(record);
      }
      if (contexts.length > 0) input = [...input, ...contexts];
    }
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
      yield* this.emitAbort("user_abort");
      return { kind: "abort", errorCode: "user_abort" };
    }

    let turnCount = 0;
    // Each turn's LLM input: the first turn is the Prompt, later turns are the previous turn's
    // tool outputs. Background notices that arrived while the session sat idle (and were not
    // taken by the host as their own task input) ride the first request, behind the Prompt.
    let nextInput: AmspRecord[] = input;
    const startNotices = yield* this.deliverBackgroundNotices();
    if (startNotices.length > 0) nextInput = [...nextInput, ...startNotices];

    for (;;) {
      // max_turns guard: end the Task with an abort coded max_turns once exceeded. A
      // non-positive cap (-1 per the config contract "must be > 0 or -1") disables the guard —
      // same convention as maxSessionTurns in shouldCompact (issue #55: -1 used to trip
      // `0 >= -1` and stop before the first turn).
      if (this.maxTurns > 0 && turnCount >= this.maxTurns) {
        // This turn's pending input (usually the previous turn's tool outputs) was never
        // submitted to the LLM: hold it as carry-over, to be resent merged with new input on
        // the next `run` (same as interruption-cleanup case A) — the previous turn's assistant
        // tool_call has already been committed by MMSP, so discarding its paired output and
        // sending a fresh message would be rejected by the provider as an unanswered tool_use
        // (400, see issue #33).
        this.pendingCarryOver = nextInput;
        const errorMessage = `reached max turns (${this.maxTurns})`;
        yield* this.emitAbort("max_turns", errorMessage);
        return { kind: "max_turns", errorCode: "max_turns", errorMessage };
      }
      turnCount += 1;

      // This turn's input. The safety invariant behind resending it: **no retryable attempt
      // is ever committed to MMSP's history**. MMSP appends a turn to `_history` only
      // after its stream has been consumed to the end and validated, so every abnormal exit —
      // whether the stream was cut, the payload failed to parse, or the request was rejected
      // outright — leaves history untouched.
      // Nothing can therefore be duplicated or left as an unanswered tool_use by a reconnect;
      // that is what makes it safe to resend this turn's input unchanged, appending a
      // `[turn_retried]` block carrying what the failed attempt already produced — the model
      // continues from there instead of re-running tools; the tag is distinct from the
      // user-interruption `[turn_aborted]`. (The one attempt MMSP does record — a fully
      // delivered response whose finish reason was not a normal one — is taken back out of its
      // history by GenerativeModel before it returns `retryable`, so it holds the same way.)
      const failedTurns: TurnResult[] = [];
      let attemptInput = nextInput;
      // Two counters, because the ladder and the ceiling answer different questions (see
      // TurnRetryState): `attempts` is every attempt this turn has made, `consecutive` only
      // the tail that received nothing. Both live and die with the turn.
      let attempts = 0;
      let consecutive = 0;
      let turn: TurnResult;

      for (;;) {
        // Both LLM and Environment handle errors internally and guarantee a complete, closed
        // output with no thrown exceptions; the engine doesn't handle exceptions —
        // it decides retry/resend purely from `outcome`. The retry count so far is threaded
        // in so the turn's request_end can announce the planned backoff (retry_in_ms) —
        // the counter lives in this loop while the event is built inside the turn.
        turn = yield* this.runTurn(
          attemptInput,
          approve,
          signal,
          { attempts, consecutive },
          preToolUse,
        );
        attempts += 1;

        // User interruption (the LLM stream was aborted, outcome=aborted, or `signal` fired
        // during tool execution): stop and hand control back to the user.
        if (signal?.aborted || turn.outcome.status === "aborted") {
          this.pendingCarryOver = this.buildCarryOver(attemptInput, turn);
          yield* this.emitAbort("user_abort");
          return { kind: "abort", errorCode: "user_abort" };
        }
        // `fatal` stops the run: a definitive provider rejection, a dead credential, or a
        // deterministic client-side rejection — the identical request can never succeed, so
        // the ladder would only delay the actionable message the outcome already carries.
        // No abort event: abort marks a user interruption, and the already-written
        // request_end (status `fatal`, `error_message`, no `retry_in_ms`) is the terminal
        // record frontends and observability read.
        if (turn.outcome.status === "fatal") {
          this.pendingCarryOver = this.buildCarryOver(attemptInput, turn);
          return {
            kind: "llm_failure",
            ...(turn.outcome.errorCode !== undefined ? { errorCode: turn.outcome.errorCode } : {}),
            ...(turn.outcome.errorMessage !== undefined
              ? { errorMessage: turn.outcome.errorMessage }
              : {}),
          };
        }
        // Completed normally.
        if (turn.outcome.status === "completed") break;

        // An image rejection is the one fatal outcome that retries: runTurn turned a provider
        // 4xx `retryable` because this input holds images (checked again here, so an LLM that
        // reports the code as retryable itself, with nothing to strip, takes the ordinary
        // ladder below). The provider refused a request the engine can change, so the retry
        // is not the identical request repeated: every image in the turn's input becomes the
        // fixed note that tells the model the picture was dropped, and the provider's text
        // reaches it through the `[request_error]` line of the retry block, like every other
        // retried failure's. The stripped input replaces the turn's input from here on, not
        // just this attempt's — an interruption, a later failure or an exhausted budget builds
        // its carry-over from it, and resending the image would only be refused again. Nothing
        // transient is being waited out, so there is no backoff and no rung on the ladder; the
        // ceiling still counts the attempt. A second rejection finds no image left and ends
        // the run through the fatal path above.
        if (
          turn.outcome.status === "retryable" &&
          turn.outcome.errorCode === "image_rejected" &&
          hasInputImages(nextInput)
        ) {
          nextInput = replaceInputImages(nextInput);
          failedTurns.push(turn);
          attemptInput = this.withRetriedTurns(nextInput, failedTurns);
          if (attempts >= this.maxTurnAttempts) {
            this.pendingCarryOver = attemptInput;
            return {
              kind: "llm_failure",
              errorCode: "image_rejected",
              ...(turn.outcome.errorMessage !== undefined
                ? { errorMessage: turn.outcome.errorMessage }
                : {}),
            };
          }
          continue;
        }

        // `retryable` remains: reconnect automatically within the same run. The class is
        // deliberately wide — the LLM interface sends every unclassifiable error here,
        // because its fatal detector is an allowlist and a gateway phrasing a transient
        // fault its own way (`Upstream HTTP/2 stream failed (upstream_http2_stream_error)`)
        // must keep its retries; the concrete failure rides on errorMessage. A response cut off
        // at its output cap (`output_truncated`, never committed) takes the same path.
        //
        // When retries are exhausted or the backoff is interrupted, the retry input is held
        // as-is as carry-over (the original input is already written to Trace, so it isn't
        // rewritten). The frontend surfaces the retry process and count via
        // request_end(retryable) followed by the next request_begin.
        failedTurns.push(turn);
        attemptInput = this.withRetriedTurns(nextInput, failedTurns);
        // Received content resets the ladder. An attempt the stream sent anything to had a
        // working connection and a model writing into it, so its drop is a fresh transport
        // fault — not the n-th piece of evidence that this endpoint is unreachable. A socket
        // that dies twice in one turn shouldn't add up to a reason to stop while
        // `[turn_retried]` carries the accumulated output into every retry and the turn keeps
        // inching forward. What bounds this is the ceiling below, not the ladder: an endpoint
        // that streams a few tokens and drops, every single time, would otherwise be retried
        // forever. A response cut off at its output cap is no exception: it received content
        // like any other, and the same ceiling bounds how often it is asked again.
        if (turn.receivedContent) consecutive = 0;
        // Exhausted: give up without an abort event — abort marks a user interruption or the
        // turn cap, and the last failure's request_end (status `retryable` with no
        // `retry_in_ms`, since no retry is planned) is the terminal record frontends and
        // observability read; `attempt` and `error_message` ride on it.
        if (consecutive >= this.maxReconnects || attempts >= this.maxTurnAttempts) {
          this.pendingCarryOver = attemptInput;
          return {
            kind: "llm_failure",
            ...(turn.outcome.errorCode !== undefined ? { errorCode: turn.outcome.errorCode } : {}),
            ...(turn.outcome.errorMessage !== undefined
              ? { errorMessage: turn.outcome.errorMessage }
              : {}),
          };
        }
        consecutive += 1;
        if (!(await this.backoff(consecutive, signal))) {
          this.pendingCarryOver = attemptInput;
          yield* this.emitAbort("backoff_interrupted");
          return { kind: "abort", errorCode: "backoff_interrupted" };
        }
      }

      // Compaction checkpoint: after every LLM Request produces token_usage. This also
      // applies mid-Task — when runTurn returns, all of this turn's
      // tool results are ready and paired with their tool_call.
      const midTask = turn.toolOutputs.length > 0;
      // The checkpoint is where compaction configuration is consulted, so it is where it is
      // re-read: the threshold and turn count `compactionTrigger` compares against, and the
      // `mode` picked from the same settings immediately below, are the values on disk right
      // now rather than the ones this context opened with.
      await this.refreshCompaction();
      const compactionReason = this.compactionTrigger();
      if (compactionReason) {
        const mode = this.compaction!.mode;
        if (mode === "discard") {
          // Once discarded, the current Task can't continue: defer until the Task really
          // ends (mid-Task, or steering/notices still queued that must continue the loop).
          // The queues are only peeked here — delivery happens at the input assembly below.
          if (!midTask && this.steeringQueue.length === 0 && this.pendingNoticeCount() === 0) {
            yield* this.discardContext(compactionReason);
            return null;
          }
        } else {
          const result = yield* this.summarizeContext(
            compactionReason,
            midTask ? turn.toolOutputs : [],
            signal,
            approve,
          );
          if (result.status === "completed") {
            // Boundary check against the **live** queues: steering or a background notice
            // may have arrived during the multi-second compaction request and must not be
            // swallowed (no await sits between this check and the return, so the window
            // cannot reopen).
            if (!midTask && this.steeringQueue.length === 0 && this.pendingNoticeCount() === 0) {
              // Task boundary: the opening is merged with the next user Prompt as the new
              // context's first input.
              this.pendingSummary = result.opening;
              this.pendingCarryOver = result.residual;
              return null;
            }
            // Mid-Task: the opening itself becomes the new LLM object's first input (this
            // turn's tool results were already folded into the compaction request); the Task
            // carries on from the next steps it names, with no hardcoded continuation
            // instruction appended. Queued steering (including anything that arrived during the
            // compaction) is delivered right after it as standalone [user_steering] user turns.
            yield* this.openPendingContext();
            await this.write(result.opening);
            const injected = [
              ...(yield* this.deliverBackgroundNotices()),
              ...(yield* this.deliverSteering()),
            ];
            nextInput = [result.opening, ...result.residual, ...injected];
            continue;
          }
          // Aborted, or no next context could be opened: the original context and Trace index
          // stay, and the next trigger compacts again. What the kept context is still owed is
          // held as carry-over (see CompactionResult): this turn's outputs when nothing
          // committed, else the outputs answering the last committed response. Mid-Task the run
          // ends, and the next run resends that carry-over merged with the user's message,
          // exactly like any interrupted turn. The run's end also discards the steering queue
          // (run's finally — control goes back to the user).
          this.pendingCarryOver = result.pending;
          if (midTask) {
            // Only the user interruption is an abort; the other end's terminal record is the
            // compaction_end (status fatal + error_message) already written.
            if (result.status === "aborted") {
              yield* this.emitAbort("compaction_interrupted");
              return { kind: "abort", errorCode: "compaction_interrupted" };
            }
            return {
              kind: "compaction_failure",
              ...(result.errorMessage !== undefined ? { errorMessage: result.errorMessage } : {}),
            };
          }
          // Task boundary: the final reply has already streamed out. A user abort hands
          // control straight back; a context that could not be opened falls through — queued
          // steering may still continue the loop, and the assembly below otherwise ends the run.
          if (result.status === "aborted") return null;
        }
      }

      // Next-input assembly — the injection delivery point: queued background notices
      // (harness user messages) and steering ([user_steering] user messages) ride alongside
      // this turn's tool outputs (or alone as the continuation input when the turn produced
      // no tool calls, instead of ending the Task — subject to the max-turns guard at the
      // top of the loop). Notices first; the user's own words come last. The whole batch is
      // user-side and reaches MMSP as ONE user message (streamGenerate merges a
      // request's input into a single UniMessage), so injections never put two adjacent
      // user messages on the wire — the per-message granularity exists only in the
      // AmspRecord stream and the Trace.
      const injected = [
        ...(yield* this.deliverBackgroundNotices()),
        ...(yield* this.deliverSteering()),
      ];
      // No tool_call this turn and nothing injected -> the Task ends (the final reply has
      // already been streamed out). A compaction stash, if any, rides the next run.
      if (!midTask && injected.length === 0) return null;
      // Anything a boundary compaction that kept the context stashed (outputs owed to its last
      // committed response) rides the very next request, ahead of the turn outputs so
      // tool_results stay contiguous and first.
      const stashed = this.pendingCarryOver;
      this.pendingCarryOver = [];
      nextInput = [...stashed, ...turn.toolOutputs, ...injected];
      if (nextInput.length === 0) return null;
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
      configured: Boolean(this.compaction && this.deps.openNextContext),
      sessionTurns: this.sessionTurns,
      fromCompaction: this.fromCompaction,
    });
  }

  /**
   * Whether a compaction left the next context's Trace file to open: the next write opens it and
   * streams its session_meta (see `openPendingContext`). A host that publishes a run's input itself
   * holds it behind that record, so the stream keeps the Trace's order.
   */
  contextOpenPending(): boolean {
    return this.pendingTraceRotation && this.deps.trace !== undefined;
  }

  async *compact(opts?: {
    signal?: AbortSignal | undefined;
    /** Compacts in this mode whatever the settings say (a model switch always summarizes). */
    mode?: CompactionMode;
    /** Approves the calls of the compaction's tool rounds, as `RunOptions.approve` does a turn's; absent denies them all. */
    approve?: ApproveFn | undefined;
    /** The note used at the hand-off rung instead of the in-place one (a model switch passes its own). */
    handoff?: AmspRecord | undefined;
  }): AsyncGenerator<AmspRecord, StopReason | undefined> {
    // The manual entry into a compaction, and the second place the live settings decide
    // something: the `mode` below, and the prompt summarizeContext reads from them.
    await this.refreshCompaction();
    if (!this.compaction || !this.deps.openNextContext) return;
    // The current context has no completed LLM turns: nothing to compact, return immediately.
    // This also guards against two /compact calls in a row — the new context is empty right
    // after the previous compaction, so running again would overwrite the not-yet-consumed
    // pendingSummary with an "empty summary," permanently losing the only record of the prior
    // conversation.
    if (this.sessionTurns === 0) return;
    if ((opts?.mode ?? this.compaction.mode) === "discard") {
      const status = yield* this.discardContext("manual");
      if (status === "completed") {
        this.pendingCarryOver = this.pendingCarryOver.filter(
          (m) => (m.payload as { type?: string }).type !== "tool_call_output",
        );
      }
      return status;
    }
    // Completed: the opening is pending, and the text the hand-off did not absorb rides behind
    // it. Otherwise the context stays with what it is still owed (PR #87 review): the prior
    // carry-over verbatim when nothing committed, else only the outputs owed to the last
    // committed response — the carry-over lives in the committed history then.
    const folded = this.pendingCarryOver;
    this.pendingCarryOver = [];
    const result = yield* this.summarizeContext(
      "manual",
      folded,
      opts?.signal,
      opts?.approve,
      opts?.handoff,
    );
    if (result.status === "completed") {
      this.pendingSummary = result.opening;
      this.pendingCarryOver = result.residual;
    } else this.pendingCarryOver = result.pending;
    return result.status;
  }

  /**
   * A model switch's rotation: closes the running context and opens the next one at once.
   * Which model the next context runs on is the opener's business (`openNextContext`, which
   * the Session owns); the engine only closes and opens. Callable at a Task boundary, with
   * compaction configured, like `compact()`.
   *
   * - A context with completed turns is closed by `compact()`, always in **summarize** mode:
   *   the summary is what the next model continues from. It is an ordinary compaction request
   *   on the running LLM object — the same model, prompt, toolset and parameters, one appended
   *   user turn — so it extends the prefix the provider has cached, and it may take tool rounds
   *   like any compaction (`approve` answers their calls). When no summary can be had, a
   *   salvaged one is taken, and `handoff` is the last rung — streamed after the meta. A stop
   *   (`aborted`) or a next context that cannot be opened (`fatal`) leaves the context as it
   *   was.
   * - A context with none has nothing to summarize and is simply replaced: no request and no
   *   event pair. Its pending text rides on in memory. Nothing is written until the next
   *   context is open, so an opener that throws leaves the Trace as it was.
   * - With no compaction configured there is no summary to ask for: given a `handoff`, the
   *   context is handed over with it.
   *
   * The next context's Trace file is then opened at once rather than at its first message:
   * its `session_meta` is the durable record of the switch — a resume reads the model from
   * the latest file — and the summary the context opens with follows it. That meta is yielded
   * last (before the handoff, when that is what the context opens with). Returns the terminal
   * status.
   */
  async *switchContext(
    signal?: AbortSignal,
    handoff?: AmspRecord,
    approve?: ApproveFn,
  ): AsyncGenerator<AmspRecord, StopReason> {
    if (this.sessionTurns === 0) return yield* this.replaceContext(this.switchCarry());
    if (!this.compaction) return handoff ? yield* this.handOverContext(handoff) : "fatal";
    const status = yield* this.compact({ signal, mode: "summarize", approve, handoff });
    if (status !== "completed") return status ?? "fatal";
    const handedOver = handoff !== undefined && this.pendingSummary === handoff;
    yield* this.openSwitchedContext();
    if (handedOver) yield handoff;
    return "completed";
  }

  /**
   * A model switch's rotation for a model that cannot be asked for a summary: nothing is sent and
   * no compaction pair is written. A context with completed turns is replaced by one that opens
   * with `handoff` in the summary's place; one with none is replaced as `switchContext` does.
   */
  async *handOverContext(handoff: AmspRecord): AsyncGenerator<AmspRecord, StopReason> {
    const opening = this.sessionTurns > 0 ? handoff : undefined;
    return yield* this.replaceContext(this.switchCarry(), opening);
  }

  /** A switch carries text alone: tool outputs and images stay with the context left behind. */
  private switchCarry(): AmspRecord[] {
    return this.pendingCarryOver.filter(isTextMessage);
  }

  /**
   * Replaces the running context; the next opens with `text` pending, after `handoff` if given:
   * written and sent where a summary would be, and streamed after the meta (nothing else does).
   * An opener that throws propagates with nothing written and the context unchanged.
   */
  private async *replaceContext(
    text: AmspRecord[],
    handoff?: AmspRecord,
  ): AsyncGenerator<AmspRecord, StopReason> {
    yield* this.adoptContext(await this.openContext());
    this.pendingCarryOver = handoff ? [handoff, ...text] : text;
    if (handoff) this.openingSummary = handoff;
    yield* this.openSwitchedContext();
    if (handoff) yield handoff;
    return "completed";
  }

  /** The eager open (see `switchContext`); the meta is streamed without a Trace sink too. */
  private async *openSwitchedContext(): AsyncGenerator<AmspRecord, StopReason> {
    const opened = await this.rotateIfPending();
    if (this.openingSummary) await this.write(this.openingSummary);
    if (this.pendingSummary) {
      // On the file now: from here it is pending input, which a run sends without writing.
      this.pendingCarryOver = [this.pendingSummary, ...this.pendingCarryOver];
      this.pendingSummary = null;
    }
    const meta = opened ?? this.contextMeta;
    if (meta) yield meta;
    return "completed";
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
    input: AmspRecord[],
    approve: ApproveFn,
    signal?: AbortSignal,
    /** This turn's retry bookkeeping from the caller's reconnect loop: lets request_end announce the NEXT attempt's planned backoff (and announce none once a budget is spent). */
    retry: TurnRetryState = { attempts: 0, consecutive: 0 },
    preToolUse?: PreToolUseFn,
  ): AsyncGenerator<AmspRecord, TurnResult> {
    const queue = new MergeQueue();
    // Tool outputs are collected in **completion order** (for streaming yield to the frontend);
    // the tool_calls' **original order** is recorded separately, and reordered back to original
    // order when fed into the next LLM turn (async tool calls: feedback order is preserved).
    const toolOutputs: AmspRecord[] = [];
    const toolCalls: AmspRecord<ToolCallPayload>[] = [];
    const callOrder: string[] = [];
    // This turn's complete thinking/text segments produced by the model (including partial
    // segments finalized on interruption), for carry-over flatten.
    const assistantSegments: AmspRecord[] = [];
    // This turn's LLM terminal state: taken from streamGenerate's generator return value.
    let outcome: LLMOutcome = { status: "completed" };
    // Set by the first message the stream yields (see TurnResult.receivedContent).
    let receivedContent = false;
    // Whether this attempt reported its usage (a completed request does, and so does one cut off
    // at its output cap).
    let sawUsage = false;

    // Driver task: consumes the LLM stream + approves one at a time + dispatches tool
    // execution. It is itself a producer.
    queue.addProducer();
    const drive = (async () => {
      try {
        // Request boundary events (replayability): start is
        // emitted when the request is issued, stop carries the terminal state at completion —
        // replay mechanically determines from these whether the turn was committed by MMSP.
        const level = this.effectiveThinkingLevel();
        const startEvt = requestBegin(level);
        queue.push(startEvt);
        await this.write(startEvt);
        // Iterate manually to capture the generator's **return value** (LLMOutcome); LLM
        // guarantees it never throws.
        const gen = this.llm.streamGenerate({
          newMessages: input,
          ...(signal ? { signal } : {}),
          ...(level !== undefined ? { thinkingLevel: level } : {}),
        });
        for (;;) {
          const res = await gen.next();
          if (res.done) {
            outcome = res.value;
            if (sawUsage && outcome.status === "completed") {
              this.sessionTurns += 1;
              // A turn completed: the summary the context opened with is history now.
              this.openingSummary = null;
            }
            // A provider's 4xx on an input that holds images is taken as a rejection of the
            // images, whatever the message says: providers word these refusals too many ways
            // to match, and a wrong match would end the run on something a retry can fix. The
            // reconnect loop answers it: it replaces the images with a note and sends the turn
            // again at once, the provider's text in the retry block's `[request_error]` line
            // for the model to judge. The rejection is recorded as what it
            // turns out to be — a retried attempt, `retryable`, coded `image_rejected` — while
            // the same 4xx on an input with no image stays `fatal` as `rejected`: whatever it
            // refuses is in the committed history or the request's parameters, beyond the
            // reach of a retry.
            const imageRetry =
              outcome.status === "fatal" &&
              outcome.errorCode === "rejected" &&
              hasInputImages(input);
            if (imageRetry) {
              outcome = {
                status: "retryable",
                errorCode: "image_rejected",
                ...(outcome.errorMessage !== undefined
                  ? { errorMessage: outcome.errorMessage }
                  : {}),
              };
            }
            // Non-completed outcomes carry the failure detail onto the event: a retried
            // request never produces an abort, so this is the only place observability
            // (the errors panel) can learn the real reason (e.g. a quota code). When the
            // engine will retry in-run, the planned backoff rides along as retry_in_ms
            // (the frontend's live countdown); absent on final failures and completions.
            // Mirrors the reconnect loop exactly, or the announced countdown is a lie: an
            // attempt that received content restarts the ladder at its first rung, either
            // budget running out means no retry is planned at all, and an image retry waits
            // for nothing.
            const retryInMs =
              retry.attempts + 1 >= this.maxTurnAttempts
                ? undefined
                : imageRetry
                  ? 0
                  : this.plannedRetryDelayMs(
                      outcome,
                      receivedContent ? 0 : retry.consecutive,
                      this.maxReconnects,
                      RETRY_STATUSES,
                    );
            const stopEvt = requestEnd(outcome.status, {
              ...(outcome.errorCode !== undefined ? { errorCode: outcome.errorCode } : {}),
              ...(outcome.errorMessage !== undefined ? { errorMessage: outcome.errorMessage } : {}),
              // The authoritative attempt ordinal (1-based, within this retry run): the
              // turn's TOTAL attempt count, which never rewinds when received content resets
              // the backoff ladder — hosts render "attempt N", and a counter that went
              // backwards mid-turn would read as a lost attempt. A clean first-try completion
              // stays unstamped so the common case adds no noise.
              ...(outcome.status !== "completed" || retry.attempts > 0
                ? { attempt: retry.attempts + 1 }
                : {}),
              ...(retryInMs !== undefined ? { retryInMs } : {}),
            });
            queue.push(stopEvt);
            await this.write(stopEvt);
            break;
          }
          const msg = res.value;
          receivedContent = true;
          // token_usage reports a Request the provider finished (completed, or cut off at its
          // output cap and billed all the same): record the context usage / Session cumulative counts —
          // stamped onto the message BEFORE it is yielded or written, so the stream and the
          // Trace carry the Session series rather than the LLM's per-request stand-in. The
          // Session turn count (per committed LLM Request, across Tasks; used for compaction
          // threshold checks) waits for the outcome: an attempt cut off at its cap is no turn.
          if (this.observeTokenUsage(msg)) sawUsage = true;
          queue.push(msg);
          await this.write(msg);
          // Collect complete thinking/text segments (including partial segments finalized on
          // interruption), for carry-over flatten.
          if (
            isCompleteModelMessage(msg) &&
            (msg.payload.type === "thinking" || msg.payload.type === "text")
          ) {
            assistantSegments.push(msg);
          }
          // Approve as soon as each complete tool_call finishes streaming. A tool call the LLM
          // closed early — its request was interrupted, failed or cut off before the call's
          // own end arrived — is written whole with the arguments that arrived, but marked (see
          // markInterruptedToolCall): it is never dispatched, isn't added to this turn's ledger,
          // and gets no paired output, since the request holding it is never committed. Its
          // Request's request_end says so; the reconnect (retryable) resends the
          // flattened carry-over, and the run-ending outcomes (aborted / fatal) exit directly.
          if (isCompleteModelMessage(msg) && msg.payload.type === "tool_call") {
            if (isInterruptedToolCall(msg)) continue;
            const tc = msg as AmspRecord<ToolCallPayload>;
            const toolCallId = tc.payload.tool_call_id;
            callOrder.push(toolCallId);
            toolCalls.push(tc);
            // Already interrupted: stop dispatching new tools, but keep consuming until the LLM
            // returns its outcome (the LLM will close out quickly and return aborted).
            if (signal?.aborted) continue;
            // Pre-tool-use hooks (RunOptions.preToolUse, wired by the Session from the
            // Agent's installed hook packages): consulted before the approval boundary,
            // every answer recorded as a `hook` event in stream order. A throw collapses
            // to no opinion — a broken hook must not decide anything.
            let hooked: PreToolUseOutcome | null = null;
            if (preToolUse) {
              try {
                hooked = await preToolUse(tc);
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                process.stderr.write(`[penguin] preToolUse consult threw: ${message}; ignoring.\n`);
              }
              if (hooked) {
                for (const ev of hooked.events) {
                  queue.push(ev);
                  await this.write(ev);
                }
              }
              if (signal?.aborted) continue;
            }
            // The approval callback is injected externally (RunOptions.approve): any throw
            // collapses to deny (conservative), so the exception never escapes the engine —
            // otherwise it would propagate through session.run without building carry-over,
            // leaving the already-committed tool_use unanswered. A hook decision skips the
            // callback: deny refuses without asking, allow approves without asking (the
            // Session already gave the command policy the last word on an allow).
            let decision: ApprovalDecision;
            if (hooked?.decision === "deny" || hooked?.decision === "allow") {
              decision = hooked.decision;
            } else {
              try {
                decision = await approve(tc);
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                process.stderr.write(`[penguin] approve callback threw: ${message}; denying.\n`);
                decision = "deny";
              }
            }
            if (signal?.aborted) continue;
            // approve is a callback; context_engine emits its decision as an approval_decision
            // AmspRecord: pushed to the stream for frontend rendering, and written to Trace.
            const decisionMsg = approvalDecision(decision, toolCallId);
            queue.push(decisionMsg);
            await this.write(decisionMsg);
            if (decision !== "allow") {
              // Denied: feed back an aborted output immediately, so the already-committed
              // tool_use never dangles. One fixed line either way — the wording names the
              // decider ("forbidden" is the command policy's answer, via the Session
              // wrapper; a hook deny names the hook and carries its reason), and the
              // approval_decision event above carries the decision itself.
              const denied = toolCallOutput({
                output:
                  hooked?.decision === "deny"
                    ? `Tool call denied by the ${hooked.name ?? "pre_tool_use"} hook${hooked.reason ? `: ${hooked.reason}` : ""}.`
                    : decision === "forbidden"
                      ? "Tool call denied by policy."
                      : "Tool call denied by user.",
                toolCallId,
                status: "aborted",
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
    const byId = new Map<string, AmspRecord>();
    for (const out of toolOutputs) {
      const id = (out.payload as { tool_call_id?: string }).tool_call_id;
      if (id !== undefined) byId.set(id, out);
    }
    const orderedOutputs: AmspRecord[] = [];
    const seen = new Set<string>();
    for (const id of callOrder) {
      if (seen.has(id)) continue; // Dedupe: feed back exactly one output per tool_call_id, to preserve pairing
      seen.add(id);
      const out = byId.get(id);
      if (out) orderedOutputs.push(out);
    }
    return { toolOutputs: orderedOutputs, toolCalls, assistantSegments, receivedContent, outcome };
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
    toolCall: AmspRecord<ToolCallPayload>,
    queue: MergeQueue,
    toolOutputs: AmspRecord[],
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
        status: "fatal",
      });
      queue.push(failed);
      await this.write(failed);
      toolOutputs.push(failed);
    }
  }

  // -------------------------------------------------------------------------
  // Context compaction
  // -------------------------------------------------------------------------

  /**
   * Re-reads the live compaction settings, if the host supplies a provider. Called at every
   * point the engine is about to decide something from them — the post-request checkpoint and
   * the two entries into a compaction — so a threshold, turn count, mode or prompt edited on
   * disk applies to the conversation that is running.
   *
   * Only refreshes an existing baseline: a Session with no `compaction` in its deps has no
   * compaction capability, and a provider must not conjure one mid-run (see
   * ContextEngineDeps.readCompaction). A read that throws keeps the settings already in force
   * and warns once — the alternative, failing the run because a config file was momentarily
   * unreadable, is worse than compacting at the previous threshold.
   */
  private async refreshCompaction(): Promise<void> {
    if (!this.compaction || !this.deps.readCompaction) return;
    try {
      this.compaction = await this.deps.readCompaction();
    } catch (e) {
      if (this.compactionReadWarned) return;
      this.compactionReadWarned = true;
      const message = e instanceof Error ? e.message : String(e);
      process.stderr.write(
        `[penguin] compaction settings could not be re-read: ${message}; keeping the settings in force.\n`,
      );
    }
  }

  /**
   * Checks the compaction threshold: triggers once context usage (the most recent
   * token_usage's request.total) or the Session cumulative turn count **reaches** the threshold
   * (>=) — e.g. maxSessionTurns=1 compacts as soon as turn 1 completes, without waiting for the
   * next Task; when both are configured, either reaching its threshold triggers compaction.
   * Never triggers when compaction is not configured.
   * Docs: /docs/agent-loop § "Compaction".
   */
  private compactionTrigger(): CompactionReason | null {
    const settings = this.compaction;
    if (!settings || !this.deps.openNextContext) return null;
    if (settings.maxContextLength > 0 && this.lastRequestTotal >= settings.maxContextLength) {
      return "context";
    }
    if (settings.maxSessionTurns > 0 && this.sessionTurns >= settings.maxSessionTurns) {
      return "turns";
    }
    return null;
  }

  /**
   * Records context usage from a token_usage event and stamps the engine-authored session
   * series onto it; returns whether the message is a token_usage. The engine is the single
   * author of `token_usage.session`: the LLM reports per-request usage only (its lifetime is
   * one model context), and this method — on the turn path and the compaction path alike —
   * accumulates the request counts and overwrites the payload's `session` before the
   * message is yielded or written.
   */
  private observeTokenUsage(msg: AmspRecord): boolean {
    if (msg.type !== "event_msg") return false;
    const payload = msg.payload as Partial<TokenUsagePayload>;
    if (payload.type !== "token_usage") return false;
    if (payload.request) {
      this.lastRequestTotal = payload.request.total;
      this.lastSessionTokens = addTokenCounts(this.lastSessionTokens, payload.request);
      (payload as TokenUsagePayload).session = this.lastSessionTokens;
    }
    return true;
  }

  /**
   * `discard` compaction: sends no compaction request, simply discards the old context —
   * swaps in a new LLM object and splits a new Trace file, with the next turn's input used
   * unchanged as the new object's first input. Only runs at a Task boundary (deferred by the
   * caller while mid-Task). Like a summarize compaction, it is declared complete only once the
   * next context is open; an opener that throws ends it `fatal` and keeps the context.
   */
  private async *discardContext(
    reason: CompactionReason,
  ): AsyncGenerator<AmspRecord, "completed" | "fatal"> {
    yield* this.emitCompactionBegin(reason, "discard");
    let next: OpenedNext;
    try {
      next = await this.openContext();
    } catch (err) {
      yield* this.emitCompactionEnd(reason, "discard", "fatal", { errorMessage: messageOf(err) });
      return "fatal";
    }
    yield* this.emitCompactionEnd(reason, "discard", "completed");
    yield* this.adoptContext(next);
    return "completed";
  }

  /**
   * `summarize` compaction: appends the compaction Prompt to the **old** LLM object (first
   * folding in this turn's tool results when mid-Task, to keep tool_use/tool_result pairing)
   * and opens the next context with what it got. The compaction requests carry the session's
   * toolset **unchanged** — the request prefix must stay byte-identical to ordinary turns so the
   * provider's prompt cache remains valid; compaction runs exactly when the context is largest
   * (issue #84 — this is why tools are *not* omitted and no `tool_choice` override is used).
   * Every request only appends to the history the one before it left.
   *
   * Each committed response is one of three (see classifyCompactionResponse): a **summary**, a
   * **round** (tool calls and no tagged summary) or **empty**. A summary's own tool calls are
   * answered and nothing more is sent. A round's calls are answered — run through the gate,
   * `approve` and the Environment while a round is open (`settings.maxRounds`, and the window
   * below `settings.roundLimit`), refused with a `[tool error]` otherwise — and their outputs go
   * out behind a line naming the rounds used and left. A refused round and an empty response
   * are corrections, answered with a corrective line; so is a response cut at the output limit,
   * asked again with the same input and one line more. Transport failures retry on the backoff
   * ladder (`compactionMaxReconnects`); a `fatal` one is not retried, except once with the
   * input's images replaced when the provider refused an input that holds them.
   *
   * The compaction ends in exactly one of three ways:
   *   - `completed`: the next context is open, and opens with the summary; when none could be
   *     had (a budget spent, or `fatal`), with the longest summary cut off before its end
   *     (pickSalvage), else with `handoff` or the hand-off note `deps.buildHandoff` builds from
   *     the Trace. Such a `compaction_end` carries the error pair saying why.
   *   - `aborted`: the user stopped it, at any point before the fallback.
   *   - `fatal`: no next context could be opened; the old context is kept.
   * In the last two, the result carries what the kept context is still owed (`pending`).
   * The next context is opened before the `compaction_end` is written, so the Trace never says
   * `completed` for a context that does not exist.
   *
   * What reaches the Human output stream between the paired compaction events: each request's
   * `request_begin` / `request_end` and `token_usage`, its thinking and text being generated
   * (issue #290 — see runCompactionRequest), and every tool call with its approval decision and
   * output, run or refused, each as the Trace has it. The Prompt and the harness lines stay
   * Trace-only.
   *
   * The opening's trailer names the compacted context's Trace file (`deps.trace.currentPath`,
   * read before the rotation), how to query it (worded for `deps.shell`), and the tool calls the
   * compaction made: text in the next context's opening, never in a running context's prefix.
   * Docs: /docs/agent-loop § "Compaction".
   */
  private async *summarizeContext(
    reason: CompactionReason,
    folded: AmspRecord[],
    signal?: AbortSignal,
    approve: ApproveFn = async () => "deny",
    handoff?: AmspRecord,
  ): AsyncGenerator<AmspRecord, CompactionResult> {
    // Already refreshed: both entries into a compaction — the post-request checkpoint and
    // `compact()` — re-read the live settings before choosing the mode that lands here, so the
    // prompt below comes from the same read as that decision rather than a second one.
    const settings = this.compaction!;
    const gate = this.deps.compactionToolGate;
    const maxRounds = settings.maxRounds ?? 0;
    yield* this.emitCompactionBegin(reason, "summarize");

    // The first request's input: this turn's tool results (mid-Task) or leftover interruption
    // carry-over, then the Prompt, as one user turn — an unanswered tool_use would get the
    // compaction request itself rejected (issue #33). Tool results were written when executed;
    // carry-over's synthetic content (flatten text, placeholders) is never written; the Prompt
    // and every harness line are written now, to the old Trace only.
    const line = async (text: string): Promise<AmspRecord> => {
      const msg = userText(text);
      await this.write(msg);
      return msg;
    };
    let input = [...folded, await line(settings.prompt)];

    // What the old context is still owed (see CompactionResult): the folded input until a
    // response is committed by MMSP — it then lives in the old object's history and must never
    // be resent (issue #85) — then the outputs answering the latest committed response's calls,
    // which lead the next request, or stay pending if the context is kept.
    let pending = folded;
    // What the requests produced (for the salvage) and every call with its output (for the
    // opening's record of them).
    const requests: SpanRequest[] = [];
    const calls: SpanCall[] = [];
    // The budgets: rounds (settings), corrections (MAX_COMPACTION_CORRECTIONS), transport
    // retries (compactionMaxReconnects), and the one image retry. `attempts` counts the
    // requests that were not rounds — the ordinal the compaction_end carries.
    let rounds = 0;
    let corrections = 0;
    let transport = 0;
    let attempts = 0;
    let imagesStripped = false;
    let truncatedLine: AmspRecord | null = null;
    const roundOpen = (): boolean =>
      gate !== undefined &&
      rounds < maxRounds &&
      (settings.roundLimit === undefined || this.lastRequestTotal < settings.roundLimit);
    // The wait announced on a request's request_end before the loop sends again (0: at once),
    // undefined when it will not: mirrors the branches below, or the countdown is a lie.
    const plannedRetry = (o: LLMOutcome): number | undefined => {
      if (o.status === "fatal") {
        return o.errorCode === "rejected" && !imagesStripped && hasInputImages(input)
          ? 0
          : undefined;
      }
      if (o.errorCode === "output_truncated") {
        return corrections < MAX_COMPACTION_CORRECTIONS ? 0 : undefined;
      }
      return this.plannedRetryDelayMs(o, transport, this.compactionMaxReconnects, RETRY_STATUSES);
    };

    // How the loop ended: a summary, a fallback with the reason for it, or a stop.
    let end: { summary: string } | { errorCode: ErrorCode; errorMessage?: string } | "aborted";
    for (;;) {
      if (signal?.aborted) {
        end = "aborted";
        break;
      }
      const open = roundOpen();
      const r = yield* this.runCompactionRequest(input, signal, attempts, plannedRetry);
      requests.push(r);
      if (r.status === "completed") {
        pending = [];
        const kind = classifyCompactionResponse(r.text, r.toolCalls.length > 0);
        if (kind === "empty") {
          attempts += 1;
          corrections += 1;
          if (corrections > MAX_COMPACTION_CORRECTIONS) {
            end = {
              errorCode: "malformed",
              errorMessage: "the response contained no usable summary",
            };
            break;
          }
          input = [await line(EMPTY_LINE)];
          continue;
        }
        if (r.toolCalls.length > 0) {
          const answered = yield* this.runCompactionToolRound(
            r.toolCalls,
            open ? gate : undefined,
            approve,
            signal,
          );
          calls.push(...answered);
          pending = answered.map((c) => c.output!);
          if (signal?.aborted) {
            end = "aborted";
            break;
          }
        }
        if (kind === "summary") {
          attempts += 1;
          end = { summary: extractSummary(r.text) };
          break;
        }
        if (open) {
          rounds += 1;
          input = [...pending, await line(roundLine(rounds, maxRounds, roundOpen()))];
          continue;
        }
        attempts += 1;
        corrections += 1;
        if (corrections > MAX_COMPACTION_CORRECTIONS) {
          end = {
            errorCode: "malformed",
            errorMessage: "the response called tools instead of writing a summary",
          };
          break;
        }
        input = [...pending, await line(CLOSED_LINE)];
        continue;
      }
      attempts += 1;
      if (r.status === "aborted") {
        end = "aborted";
        break;
      }
      // Not committed: the input is still owed in full, so every resend below starts from it.
      const failure = {
        errorCode: r.errorCode ?? "malformed",
        ...(r.errorMessage !== undefined ? { errorMessage: r.errorMessage } : {}),
      };
      if (r.status === "fatal") {
        // The turn loop's image rule, once and outside every budget: a refused input that
        // holds images is sent again with each image replaced by the fixed note.
        if (r.errorCode === "rejected" && !imagesStripped && hasInputImages(input)) {
          imagesStripped = true;
          input = replaceInputImages(input);
          continue;
        }
        end = failure;
        break;
      }
      if (r.errorCode === "output_truncated") {
        // A correction, not a transient fault: asked again at once, with one line more.
        corrections += 1;
        if (corrections > MAX_COMPACTION_CORRECTIONS) {
          end = failure;
          break;
        }
        truncatedLine ??= await line(TRUNCATED_LINE);
        if (input.at(-1) !== truncatedLine) input = [...input, truncatedLine];
        continue;
      }
      if (transport >= this.compactionMaxReconnects) {
        end = failure;
        break;
      }
      transport += 1;
      if (!(await this.backoff(transport, signal))) {
        end = "aborted";
        break;
      }
    }

    // A stop that lands before the fallback keeps the context like any other stop.
    if (end === "aborted" || (!("summary" in end) && signal?.aborted)) {
      yield* this.emitCompactionEnd(
        reason,
        "summarize",
        "aborted",
        attempts > 0 ? { attempt: attempts } : undefined,
      );
      return { status: "aborted", pending };
    }
    const summary = "summary" in end ? end.summary : pickSalvage(requests);
    let next: OpenedNext;
    try {
      next = await this.openContext();
    } catch (err) {
      const errorMessage = messageOf(err);
      yield* this.emitCompactionEnd(reason, "summarize", "fatal", {
        attempt: attempts,
        errorMessage,
      });
      return { status: "fatal", pending, errorMessage };
    }
    // The trailer names the file being closed: the rotation is not armed yet, so the Trace's
    // current path is this context's own file.
    const tracePath = this.deps.trace?.currentPath?.();
    const shell = this.deps.shell !== undefined ? { shell: this.deps.shell } : {};
    const opening =
      summary !== null
        ? userText(
            buildContextSummaryText(
              summary,
              tracePath !== undefined ? { tracePath, ...shell } : undefined,
              {
                callLines: compactionCallLines(calls),
                cutOff: !("summary" in end),
                ...(next.opened.notice !== undefined ? { notice: next.opened.notice } : {}),
              },
            ),
          )
        : (handoff ?? (await this.inPlaceHandoff(tracePath)));
    yield* this.emitCompactionEnd(reason, "summarize", "completed", {
      attempt: attempts,
      ...("summary" in end ? {} : end),
    });
    yield* this.adoptContext(next);
    this.openingSummary = opening;
    // A hand-off absorbed nothing: the text input the compaction held rides on behind the note.
    return {
      status: "completed",
      opening,
      residual: summary !== null ? [] : folded.filter(isTextMessage),
    };
  }

  /**
   * The hand-off note a context opens with when no summary could be had: the one
   * `deps.buildHandoff` builds from the Trace file, or — without one, or when it throws — the
   * bare note, which is pure string work, so this rung cannot fail.
   */
  private async inPlaceHandoff(tracePath: string | undefined): Promise<AmspRecord> {
    if (this.deps.buildHandoff) {
      try {
        return await this.deps.buildHandoff();
      } catch (err) {
        process.stderr.write(
          `[penguin] the compaction hand-off note could not be built: ${messageOf(err)}; using the bare note.\n`,
        );
      }
    }
    return userText(
      buildCompactionHandoff([], {
        ...(tracePath !== undefined ? { tracePath } : {}),
        ...(this.deps.shell !== undefined ? { shell: this.deps.shell } : {}),
      }),
    );
  }

  /**
   * Answers every call of a committed compaction response, in call order. With no round open
   * (`gate` absent) each call is refused at once — a `fatal` `[tool error]` output, never put
   * to `approve`. Otherwise each call goes to the gate first — refused (a gate that throws
   * refuses with its message), it gets a `fatal` `[tool error] <reason>` output at once — then
   * to `approve`, recorded as an `approval_decision` exactly as a turn's call is (a callback
   * that throws counts as a denial); a denied call gets the turn loop's denied output, an
   * approved one runs through `executeOne` (the Environment, the signal, its partial outputs),
   * concurrently with the approvals after it as in a turn. Every record is written to the old
   * Trace and streamed.
   *
   * On an interruption the remaining calls are no longer asked about, a running tool is
   * aborted by the signal (the Environment closes it with an `aborted` output), and every call
   * still without an output gets an aborted placeholder — written and streamed, so the old
   * context stays pairable and a resume reads the same pairing. Returns each call with its
   * output, in call order: the outputs are the next request's input.
   */
  private async *runCompactionToolRound(
    toolCalls: AmspRecord<ToolCallPayload>[],
    gate: CompactionToolGate | undefined,
    approve: ApproveFn,
    signal?: AbortSignal,
  ): AsyncGenerator<AmspRecord, SpanCall[]> {
    // One output per tool_call_id (a provider reusing an id is answered once, as in runTurn).
    const calls: AmspRecord<ToolCallPayload>[] = [];
    const seen = new Set<string>();
    for (const tc of toolCalls) {
      if (seen.has(tc.payload.tool_call_id)) continue;
      seen.add(tc.payload.tool_call_id);
      calls.push(tc);
    }
    const queue = new MergeQueue();
    const outputs: AmspRecord[] = [];
    const answer = async (out: AmspRecord): Promise<void> => {
      queue.push(out);
      await this.write(out);
      outputs.push(out);
    };
    queue.addProducer();
    const drive = (async () => {
      try {
        for (const tc of calls) {
          if (signal?.aborted) break;
          const toolCallId = tc.payload.tool_call_id;
          const refusal = compactionRefusal(tc, gate);
          if (refusal !== null) {
            await answer(
              toolCallOutput({ output: `[tool error] ${refusal}`, toolCallId, status: "fatal" }),
            );
            continue;
          }
          let decision: ApprovalDecision;
          try {
            decision = await approve(tc);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            process.stderr.write(`[penguin] approve callback threw: ${message}; denying.\n`);
            decision = "deny";
          }
          if (signal?.aborted) break;
          const decisionMsg = approvalDecision(decision, toolCallId);
          queue.push(decisionMsg);
          await this.write(decisionMsg);
          if (decision !== "allow") {
            await answer(
              toolCallOutput({
                output:
                  decision === "forbidden"
                    ? "Tool call denied by policy."
                    : "Tool call denied by user.",
                toolCallId,
                status: "aborted",
              }),
            );
            continue;
          }
          queue.addProducer();
          void this.executeOne(tc, queue, outputs, signal, approve).finally(() => {
            queue.removeProducer();
          });
        }
      } finally {
        queue.removeProducer();
      }
    })();
    for (;;) {
      const msg = await queue.next();
      if (msg === null) break;
      yield msg;
    }
    await drive;
    const byId = new Map<string, AmspRecord>();
    for (const out of outputs) {
      const id = (out.payload as { tool_call_id?: string }).tool_call_id;
      if (id !== undefined) byId.set(id, out);
    }
    const answered: SpanCall[] = [];
    for (const tc of calls) {
      let out = byId.get(tc.payload.tool_call_id);
      if (!out) {
        out = toolCallOutput({
          output: "[interrupted: tool aborted by user]",
          toolCallId: tc.payload.tool_call_id,
          status: "aborted",
        });
        await this.write(out);
        yield out;
      }
      answered.push({ call: tc, output: out as AmspRecord<ToolCallOutputPayload> });
    }
    return answered;
  }

  /**
   * Issues one compaction request — an ordinary LLM Request through the same object and the
   * same frozen config as every other turn (the toolset is deliberately identical: a changed
   * tool list would change the request prefix and invalidate the provider's prompt cache at
   * the moment the context is largest, issue #84). Consumes the old LLM object's streamed
   * output, writing every complete message and event to the old Trace. What also rides the
   * Human output stream, each right after its write and in the Trace's order: the request's
   * `request_begin` / `request_end` and its `token_usage`; the thinking and the text being
   * generated, as their own ordinary `partial_thinking`/`thinking` and `partial_text`/`text`
   * messages (issue #290) so the frontend can show the compaction request working while it
   * runs; and its `partial_tool_call` / `tool_call` records, as a turn streams them, whether
   * the calls will run or be refused. Readers treat model messages between the paired
   * compaction events as compaction-internal, and history rebuild reads the identical content
   * back from the span's records. Complete text segments are collected as the response's text,
   * and `toolCalls` collects its real tool requests, which summarizeContext answers. Token usage
   * is counted into the Session cumulative totals (stamped onto every token_usage via
   * observeTokenUsage).
   */
  private async *runCompactionRequest(
    input: AmspRecord[],
    signal: AbortSignal | undefined,
    /** Requests of this compaction that were not rounds, before this one: the ordinal its request_end carries, as the compaction_end does. */
    attemptsSoFar: number,
    /** The wait the compaction loop will take before sending again after this outcome (see summarizeContext); announced as retry_in_ms. */
    plannedRetry: (outcome: LLMOutcome) => number | undefined,
  ): AsyncGenerator<
    AmspRecord,
    {
      status: StopReason;
      text: string;
      toolCalls: AmspRecord<ToolCallPayload>[];
      /** Classified cause and error detail (LLMOutcome) on non-completed statuses — become compaction_end.error_code / error_message when this failure ends the compaction. */
      errorCode?: ErrorCode;
      errorMessage?: string;
    }
  > {
    // The compaction request is itself an ordinary Request, emitting paired request events,
    // written to the old Trace and streamed (a frontend restarts the summary draft at each
    // request_begin).
    // The effective thinking level, resolved live and carried exactly as a turn carries it
    // (see the `thinkingLevel` field): the level is the soft-limited per-request parameter, so
    // one Session never has two levels in flight at once. Were this request left on the level
    // the context opened at while the turns around it run on the pin, a provider that reads the
    // level as a thinking mode would see the mode change mid-conversation — and DeepSeek
    // rejects a request whose current tool-call chain replays a turn that carries no chain of
    // thought. The strict-tier prefix this request does hold identical to a turn's is its
    // system prompt and toolset; the level is a request parameter, not part of either.
    const level = this.effectiveThinkingLevel();
    const startEvt = requestBegin(level);
    await this.write(startEvt);
    yield startEvt;
    const gen = this.llm.streamGenerate({
      newMessages: input,
      ...(signal ? { signal } : {}),
      ...(level !== undefined ? { thinkingLevel: level } : {}),
    });
    let text = "";
    const toolCalls: AmspRecord<ToolCallPayload>[] = [];
    // Whether this attempt streamed any partial_text / partial_thinking content: real LLM
    // objects stream the summary (and the thinking ahead of it) as partial fragments
    // (forwarded verbatim), and the complete message that follows must then stay off the
    // stream or consumers would see the content twice; an implementation that yields only
    // complete messages streams those instead. Tracked per kind, so a model that streams its
    // thinking but delivers its text whole still gets that text forwarded once.
    let sawPartialText = false;
    let sawPartialThinking = false;
    for (;;) {
      const res = await gen.next();
      if (res.done) {
        // Same failure-detail + planned-retry pass-through as the turn loop's request_end. A
        // completed response plans no retry: what follows it is a round or a correction, sent
        // at once.
        const retryInMs = res.value.status === "completed" ? undefined : plannedRetry(res.value);
        const stopEvt = requestEnd(res.value.status, {
          ...(res.value.errorCode !== undefined ? { errorCode: res.value.errorCode } : {}),
          ...(res.value.errorMessage !== undefined ? { errorMessage: res.value.errorMessage } : {}),
          // Same stamping rule as the turn loop: a clean first attempt stays unstamped.
          ...(res.value.status !== "completed" || attemptsSoFar > 0
            ? { attempt: attemptsSoFar + 1 }
            : {}),
          ...(retryInMs !== undefined ? { retryInMs } : {}),
        });
        await this.write(stopEvt);
        yield stopEvt;
        return {
          status: res.value.status,
          text,
          toolCalls,
          ...(res.value.errorCode !== undefined ? { errorCode: res.value.errorCode } : {}),
          ...(res.value.errorMessage !== undefined ? { errorMessage: res.value.errorMessage } : {}),
        };
      }
      const msg = res.value;
      // Stamped with the Session series before the write, exactly like a turn's (runTurn);
      // every attempt's usage rides the stream (failed attempts burn real tokens, issue #170).
      const isUsage = this.observeTokenUsage(msg);
      await this.write(msg);
      if (isUsage) {
        yield msg;
        continue;
      }
      // Streamed compaction progress (issue #290): the request's thinking and the summary's
      // own text ride the output stream between the paired compaction events —
      // partial_thinking / partial_text fragments verbatim (all three phases, so the server's
      // live tail opens and closes its fragment and a join mid-compaction is seeded with the
      // accumulated prefix), or the complete thinking / text when no partial of that kind
      // carried content (implementations that yield only complete messages) — never both,
      // so consumers see each character once. Rejected attempts stream too: the frontend
      // shows whatever the compaction request is really producing, and history rebuild reads
      // the same content back from the span's complete assistant messages.
      {
        const p = msg.payload as { type?: string; text?: string; thinking?: string };
        if (p.type === "partial_text") {
          if (typeof p.text === "string" && p.text !== "") sawPartialText = true;
          yield msg;
        } else if (p.type === "partial_thinking") {
          if (typeof p.thinking === "string" && p.thinking !== "") sawPartialThinking = true;
          yield msg;
        } else if (p.type === "partial_tool_call") {
          yield msg;
        }
      }
      if (isCompleteModelMessage(msg)) {
        if (msg.payload.type === "text") {
          const body = (msg.payload as TextPayload).text;
          text += body;
          if (!sawPartialText && body !== "") yield msg;
        } else if (msg.payload.type === "thinking") {
          // Forwarded for the banner only — the thinking is never summary material (the
          // extraction reads `text` alone) — and a fidelity-only blank body has nothing to
          // show.
          const body = (msg.payload as ThinkingPayload).thinking;
          if (!sawPartialThinking && body !== "") yield msg;
        } else if (msg.payload.type === "tool_call") {
          // Calls stream whole, after their fragments, as a turn's do.
          yield msg;
          // Same rule as the turn loop: a tool call closed early (its request ended before the
          // call did) is no real request and gets no paired output; every other one needs one.
          if (!isInterruptedToolCall(msg)) toolCalls.push(msg as AmspRecord<ToolCallPayload>);
        }
      }
    }
  }

  /**
   * Opens the next model context through `openNextContext`, holding the records it publishes
   * while opening (its MCP connect pair, its tool_list_ready) for `adoptContext`. Changes
   * nothing here: an opener that throws propagates with the old context still current.
   */
  private async openContext(): Promise<OpenedNext> {
    const records: AmspRecord[] = [];
    const opened = await this.deps.openNextContext!({ emit: (msg) => records.push(msg) });
    return { opened, records };
  }

  /**
   * Makes an opened context the running one: swaps in its LLM object, adopts whatever it
   * brings — its session_meta and toolset records for the rotated Trace file's head, its engine
   * settings — resets the Session turn count and context usage counter, and yields the records
   * the opener published. Called after the compaction_end is written, which must land in the
   * old file. Trace **does not** split files immediately — that's deferred until the next
   * message that needs writing, when it rotates and opens with the context's session_meta and
   * records, streaming the meta (see `openPendingContext`), avoiding an empty file if no
   * further messages follow the compaction; a model switch opens the file right after this
   * returns instead (see `switchContext`).
   */
  private async *adoptContext({ opened, records }: OpenedNext): AsyncGenerator<AmspRecord> {
    this.pendingTraceRotation = true;
    this.llm = opened.llm;
    if (opened.sessionMeta) this.contextMeta = opened.sessionMeta;
    if (records.length > 0) this.contextRecords = records;
    if (opened.maxTurns !== undefined) this.maxTurns = opened.maxTurns;
    // The new context's baseline. A `readCompaction` provider re-reads the same file at the
    // next checkpoint and agrees with it; what this settles is the Session that has no
    // provider, where the rotation is still the only way compaction settings change.
    if (opened.compaction) this.compaction = opened.compaction;
    this.sessionTurns = 0;
    this.lastRequestTotal = 0;
    // First-run records no run has written yet describe the context this one replaces: they
    // are dropped with it rather than written into this context's file.
    this.pendingBootstrapRecords = null;
    // Lets compactability() distinguish "just compacted" from "hasn't chatted yet" — both have
    // sessionTurns === 0, but they mean two completely different things to the user (being told
    // "no completed conversation turns yet" right after compacting is as good as saying nothing).
    this.fromCompaction = true;
    yield* records;
  }

  /** Yields and records a compaction start event (carrying reason/mode/current context usage/Session cumulative turns). */
  private async *emitCompactionBegin(
    reason: CompactionReason,
    mode: CompactionMode,
  ): AsyncGenerator<AmspRecord> {
    const msg = compactionBegin({
      reason,
      mode,
      context: this.lastRequestTotal,
      turns: this.sessionTurns,
    });
    yield msg;
    await this.write(msg);
  }

  /** Yields and records a compaction stop event: the result status — `completed` replaced the context, and with an error pair it did so without a full summary — plus its share of the RetryDetail block (final attempt ordinal, error detail). */
  private async *emitCompactionEnd(
    reason: CompactionReason,
    mode: CompactionMode,
    status: StopReason,
    detail?: { attempt?: number; errorCode?: ErrorCode; errorMessage?: string },
  ): AsyncGenerator<AmspRecord> {
    const msg = compactionEnd({ reason, mode, status, ...detail });
    yield msg;
    await this.write(msg);
  }

  /** User interruption, or the turn cap: emits an abort event carrying the machine-readable cause. Cleanup/resending is managed centrally by `run` via carry-over; the LLM history is never touched again. */
  private async *emitAbort(
    errorCode: "user_abort" | "backoff_interrupted" | "compaction_interrupted" | "max_turns",
    errorMessage?: string,
  ): AsyncGenerator<AmspRecord> {
    const msg = abortEvent(errorCode, errorMessage);
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
   * - Model output completed (case A, outcome=completed): MMSP already committed an
   *   assistant turn containing `tool_call`, so it can only be resent as a structured
   *   `tool_call_output` to pair with it (cannot flatten, or the already-committed tool_call
   *   would be left unanswered and rejected).
   * - Model output incomplete (case B): the `tool_call_output` in this turn's input (paired
   *   with the previous completed turn) is kept as-is; the text input and this turn's
   *   thinking/text/tool call/result are flattened into a single `[turn_aborted]` plain-text
   *   user message.
   * Docs: /docs/agent-loop § "Interruption and carry-over".
   */
  private buildCarryOver(attemptInput: AmspRecord[], turn: TurnResult): AmspRecord[] {
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
            status: "aborted",
          }),
        );
      // Placeholders are sent to the model only and not written to Trace (synthetic carry-over
      // isn't persisted); resumption replay re-synthesizes placeholders as needed to guarantee
      // pairing (pairing fallback). Real outputs were already
      // written when produced.
      return backfill.length ? [...turn.toolOutputs, ...backfill] : turn.toolOutputs;
    }
    return this.flattenCarryOver(attemptInput, turn);
  }

  /**
   * Case B: flattens this attempt's input and its produced content into carry-over. Structured
   * `tool_call_output` in the input (paired with the previous completed turn) is kept as-is;
   * everything else (text input, model thinking/text, this attempt's tool calls/results) is
   * transcribed into a single `[turn_aborted]` plain-text user message (includes all
   * completed and incomplete messages, including partial thinking/text). If the input text is
   * itself already a `[turn_aborted]` block (from a previous attempt or a previous run's
   * carry-over), its content is unwrapped and merged in, keeping a single-level structure. The
   * block ends with one `[request_error]` line when this attempt failed (`fatal` or
   * `retryable`): the failure's code and text, so the next request — the user's next message,
   * or a host's Retry — tells the model why the turn is being sent again. A merged block's own
   * request_error line is dropped first, so there is never more than one, and a user
   * interruption (no error) leaves none.
   *
   * TODO(multimodal): only text input is currently kept — `image_url` / `inline_data` input is
   * lost during flatten (the `[turn_aborted]` structure has no corresponding transcription yet);
   * multimodal carry-over support to be added later.
   */
  private flattenCarryOver(attemptInput: AmspRecord[], turn: TurnResult): AmspRecord[] {
    const structured = attemptInput.filter(
      (m) => (m.payload as { type?: string }).type === "tool_call_output",
    );
    const textInputs = attemptInput.filter((m) => (m.payload as { type?: string }).type === "text");
    const flattened = userText(this.buildTurnAbortedText(textInputs, turn));
    // flatten is sent to the model only and not written to Trace (synthetic carry-over isn't
    // persisted): resumption replay resends the discarded turn's **original input** as-is
    // (best-effort), with no dependency on this synthetic message.
    return [...structured, flattened];
  }

  /** Transcribes the interrupted turn's input, model thinking/text, tool calls/results and (after a failure) the error into a single `[turn_aborted]` plain-text block. */
  private buildTurnAbortedText(textInputs: AmspRecord[], turn: TurnResult): string {
    const lines: string[] = [];
    for (const m of textInputs) {
      const t = (m.payload as TextPayload).text;
      // If this text is itself already a synthetic block — a previous run's `[turn_aborted]`,
      // or this turn's reconnect-appended `[turn_retried]` — extract its inner lines and merge
      // them in directly, avoiding layered nesting / unbounded growth (keeping a single-level
      // structure). Its request_error line describes an older failure: dropped, so the block
      // carries this turn's outcome alone.
      const inner = unwrapSyntheticBlock(t);
      if (inner !== null) {
        const kept = stripRequestErrorLines(inner);
        if (kept) lines.push(kept);
      } else {
        lines.push(transcribeUserInput(t));
      }
    }
    lines.push(...transcribeTurnLines(turn.assistantSegments, turn.toolCalls, turn.toolOutputs));
    const error = requestErrorLine(turn.outcome);
    if (error !== null) lines.push(error);
    return buildTurnAbortedBlock(lines);
  }

  /**
   * Assembles the reconnect retry input: the original input is kept as-is (structure and
   * multimodal content preserved), with a `[turn_retried]` text appended at the end carrying
   * each failed attempt's thinking/text and tool calls/results produced so far, closed by one
   * `[request_error]` line with the latest failure's code and text — rebuilt from scratch on
   * every attempt, so a turn retried five times still carries one such line, not five. The
   * model reads why the request failed before it carries on, instead of being handed the same
   * input again with no word of what happened. The synthetic message is sent to the model only
   * and not written to Trace (same rule as flatten carry-over).
   * Docs: /docs/agent-loop § "Automatic reconnect".
   */
  private withRetriedTurns(input: AmspRecord[], failedTurns: TurnResult[]): AmspRecord[] {
    const lines = failedTurns.flatMap((t) =>
      transcribeTurnLines(t.assistantSegments, t.toolCalls, t.toolOutputs),
    );
    const last = failedTurns.at(-1);
    const error = last ? requestErrorLine(last.outcome) : null;
    if (error !== null) lines.push(error);
    if (lines.length === 0) return input;
    return [...input, userText(buildTurnRetriedBlock(lines))];
  }

  /**
   * Performs the deferred Trace rotation when one is pending: splits the file and opens it with
   * the current context's session_meta and records (its MCP connect pair, if any, and its
   * toolset). Best-effort like every Trace write. Returns the session_meta it wrote (attempted,
   * whatever the outcome), for the caller to stream; null when nothing was pending. Reached
   * through `openPendingContext` by the first write after a compaction, through `write` as a
   * backstop, and directly by `switchContext`, which opens the file at once.
   */
  private async rotateIfPending(): Promise<AmspRecord | null> {
    const trace = this.deps.trace;
    if (!trace || !this.pendingTraceRotation) return null;
    this.pendingTraceRotation = false;
    try {
      if (trace.rotate) await trace.rotate();
      if (this.contextMeta) await trace.write(this.contextMeta);
      for (const record of this.contextRecords) await trace.write(record);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[trace] rotate failed: ${message}\n`);
    }
    return this.contextMeta ?? null;
  }

  /**
   * Opens the file a compaction left pending, when one is, and streams its session_meta: the
   * main Session's every session_meta is on the stream exactly once, at the moment it is
   * written. Called right before the write that opens the file — the run's input (a Task's
   * first write, after its `task_begin`; the Session calls it before yielding a continued
   * Task's input) and a mid-Task summary. The records the opener emitted were streamed when the
   * context opened and are only written here.
   */
  async *openPendingContext(): AsyncGenerator<AmspRecord> {
    const opened = await this.rotateIfPending();
    if (opened) yield opened;
  }

  /**
   * Trace writes are **best-effort**: observability should never interrupt the ReAct
   * loop, so write failures only warn rather than throw. The first write after compaction first
   * performs the deferred Trace rotation (see `rotateIfPending`) — a backstop: the two writes
   * that come first after a compaction (a run's input, a mid-Task summary) open the file through
   * `openPendingContext`, which streams its session_meta.
   */
  private async write(msg: AmspRecord): Promise<void> {
    await this.rotateIfPending();
    if (!this.deps.trace) return;
    try {
      await this.deps.trace.write(msg);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[trace] write failed: ${message}\n`);
    }
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * What a committed compaction response is. Text only: a summary unless it extracts empty — the
 * lenient rule, which accepts a tagless reply. With tool calls: a summary only when it holds a
 * tagged one (closed, or long enough to salvage), otherwise a round, its text a preamble.
 */
function classifyCompactionResponse(
  text: string,
  calledTools: boolean,
): "summary" | "round" | "empty" {
  if (!calledTools) return extractSummary(text) !== "" ? "summary" : "empty";
  const tagged = summaryInTags(text);
  return tagged !== null &&
    tagged.text !== "" &&
    (tagged.closed || tagged.text.length >= SALVAGE_MIN_CHARS)
    ? "summary"
    : "round";
}

/** Why a compaction call may not run (its `[tool error]` text), or null when it may: no round open (no gate), or the gate's refusal — a gate that throws refuses with its message. */
function compactionRefusal(
  toolCall: AmspRecord<ToolCallPayload>,
  gate: CompactionToolGate | undefined,
): string | null {
  if (gate === undefined) return REFUSED_NO_ROUND;
  try {
    const verdict = gate(toolCall);
    return verdict.allow ? null : verdict.reason;
  } catch (err) {
    return messageOf(err);
  }
}

/**
 * The `[request_error]` line for a failed attempt's outcome (`fatal` or `retryable`, with
 * whatever code and text it carries — an idle timeout has a code and no text), or null for an
 * outcome that is no failure: a completed request, or a user interruption.
 */
function requestErrorLine(outcome: LLMOutcome): string | null {
  if (outcome.status !== "fatal" && outcome.status !== "retryable") return null;
  if (outcome.errorCode === undefined && outcome.errorMessage === undefined) return null;
  return transcribeRequestError(outcome.errorCode, outcome.errorMessage);
}

/** Transcribes the model's produced thinking/text and tool calls/results into tagged lines (shared by `[turn_aborted]`/`[turn_retried]`). */
function transcribeTurnLines(
  assistantSegments: AmspRecord[],
  toolCalls: AmspRecord<ToolCallPayload>[],
  toolOutputs: AmspRecord[],
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
    lines.push(transcribeToolCallOutput(p.tool_call_id, p.status ?? "completed", p.output));
  }
  return lines;
}
