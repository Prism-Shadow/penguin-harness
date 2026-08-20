/**
 * OmniMessage — PenguinHarness's primary message protocol.
 *
 * All messages share one envelope: `timestamp` (ISO 8601 UTC), `type`, and `payload`.
 * The outer `type` falls into three categories:
 *   - `session_meta`: Session metadata;
 *   - `model_msg`: model input/output messages (both complete messages and streaming
 *     `partial_*` messages);
 *   - `event_msg`: control/statistics events during execution.
 *
 * Trace records only: `session_meta`, complete `model_msg`, and all `event_msg`;
 * the Human interface communicates using: complete `model_msg`, streaming `partial_*`, and all
 * `event_msg`.
 *
 * Docs: packages/docs/content/omni-message.{zh,en}.md (site path /docs/omni-message) documents
 * this protocol payload-for-payload — keep the page in sync when changing types here.
 */

/** The outer message category. */
export type OmniMessageType = "session_meta" | "model_msg" | "event_msg";

/** The message's originating role. */
export type Role = "user" | "assistant";

/**
 * The reason a model response or message generation ended. Only six protocol values are
 * allowed:
 *   - `completed`: finished normally, including completed text, thinking, tool requests, or
 *     tool output;
 *   - `failed`: a non-retryable error or tool execution failure;
 *   - `aborted`: user-initiated interruption or cancellation;
 *   - `timeout`: LLM request timed out;
 *   - `malformed`: the LLM response was malformed (e.g. AgentHub JSON parsing exception).
 *     Only LLM timeout / malformed trigger a context_engine reconnect;
 *   - `auth`: the LLM rejected the credentials (see `isAuthenticationError`) — a
 *     `failed`-shaped stop that no in-run retry can fix; hosts disable input until the
 *     model's API key is updated (only the model reference is fixed at Session creation —
 *     credentials come from the current Project config), after which the Session
 *     continues.
 * Docs: /docs/omni-message § "stop_reason".
 */
export type StopReason = "completed" | "failed" | "aborted" | "timeout" | "malformed" | "auth";

/** The event phase of a streaming fragment. `stop` marks the end of a fragment and usually carries no incremental content. */
export type StreamEventType = "start" | "delta" | "stop";

/**
 * Nested-origin marker: a child Session id. The message envelope's `origin` is a chain of child
 * Session ids ordered **outer-to-inner**, identifying that the message comes from a nested child
 * session (e.g. a child Session derived by `run_subagent`); each layer of host-tool forwarding
 * prepends one more hop at the front. **An absent `origin` (the message carries no `origin`)
 * means the message comes from the main Session itself** (an empty array is never produced
 * either). Only session_id is recorded: the corresponding tool_call / agent info can be obtained
 * from the `run_subagent` tool_call in the parent session's stream and the child Session's own
 * Trace (session_meta).
 * Docs: /docs/omni-message § "origin: the Subagent chain".
 */
export type MessageOrigin = string;

/** The approval decision for a tool call. */
export type ApprovalDecision = "allow" | "deny";

/** Token counts (input/output/cache/total). */
export interface TokenCounts {
  cache_read: number;
  cache_write: number;
  output: number;
  total: number;
}

// ---------------------------------------------------------------------------
// session_meta
// ---------------------------------------------------------------------------
// Docs: /docs/omni-message § "session_meta"

/** Tool definition passed to the LLM (OpenAI/JSON Schema style). */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

/**
 * Session metadata. Holds **per-session invariants only** — values fixed for the Session's
 * lifetime (model reference, assembled system prompt, tool schemas, paths, origin). Per-turn
 * parameters (e.g. the thinking level, passed with each run) never belong here; a
 * `thinking_level` field still present in a legacy Trace's meta is ignored on resume.
 */
export interface SessionMetaPayload {
  session_id: string;
  /** The session model's provider group (paired with `model_id` to form a model reference). */
  provider: string;
  /** The session model's upstream model_id (the request id sent to AgentHub; paired with `provider`). */
  model_id: string;
  model_context_window: number | string;
  /** The system prompt actually used by this Session (the assembled result with environment placeholders already substituted). */
  system_prompt: string;
  // The tool definitions were embedded here (`tools`) before the tool_list_ready split (see
  // ToolListReadyPayload): the toolset is only known after MCP servers connect, and meta
  // must not wait for that. Pre-split Traces still carry the field on disk; it is
  // deliberately not read anywhere anymore (explicit incompatibility — their tool record
  // is simply not displayed).
  /** Absolute path to the Agent State. */
  agent_state: string;
  /** Absolute path to the Workspace. */
  workspace: string;
  /** Session origin: spawned by a subagent / triggered by a scheduled task; absent = user-created. */
  source?: "subagent" | "schedule";
}

// ---------------------------------------------------------------------------
// model_msg — complete messages
// ---------------------------------------------------------------------------
// Docs: /docs/omni-message § "model_msg: complete payloads"

/**
 * Provider-fidelity payload (mirrors AgentHub's `Fidelity`): an arbitrary JSON-style object of
 * wire-level data the LLM client records to reproduce the original message on replay — thinking
 * signatures, phase labels, encrypted reasoning, the upstream reasoning field name, etc. Opaque
 * to PenguinHarness: written to the Trace as-is and passed back verbatim; some models **require**
 * it when history is replayed (e.g. Claude thinking signatures, GPT-5 encrypted reasoning) —
 * losing it breaks Session resumption.
 */
export type Fidelity = Record<string, unknown>;

/**
 * Who produced a user-role text: the human user, a parent agent driving a subagent session
 * (run_subagent / input_subagent prompts), or the harness itself (automatic injections such
 * as background-task completion reports). Absent = `"user"` — Traces written before this
 * field existed carry only human input on the user side, so the default is also the
 * historically correct reading.
 */
export type TextSender = "user" | "agent" | "harness";

export interface TextPayload {
  type: "text";
  role: Role;
  text: string;
  /** Origin of a user-role text (never sent to the provider); absent = the human user. See {@link TextSender}. */
  sender?: TextSender;
  stop_reason?: StopReason;
  /** Provider-fidelity payload (e.g. `phase` for GPT-5 segment markers, `signature`), kept as-is and restored verbatim. */
  fidelity?: Fidelity;
}

export interface ImageUrlPayload {
  type: "image_url";
  role: "user";
  /** A web URL or a base64 data URL. */
  image_url: string;
  stop_reason?: StopReason;
}

export interface InlineDataPayload {
  type: "inline_data";
  role: Role;
  /** Base64-encoded bytes. */
  data: string;
  mime_type: string;
  stop_reason?: StopReason;
  /** Provider-fidelity payload, kept as-is and restored verbatim. */
  fidelity?: Fidelity;
}

export interface ThinkingPayload {
  type: "thinking";
  role: "assistant";
  thinking: string;
  stop_reason?: StopReason;
  /**
   * Provider-fidelity payload closing the thinking block (Claude thinking signatures / redacted
   * thinking, GPT-5 encrypted reasoning, the OpenAI-compatible reasoning field name, etc. —
   * **required** when some models replay history), kept as-is and restored verbatim — losing it
   * breaks Session resumption.
   */
  fidelity?: Fidelity;
}

export interface InlineThinkingPayload {
  type: "inline_thinking";
  role: "assistant";
  /** Base64-encoded bytes. */
  data: string;
  mime_type: string;
  stop_reason?: StopReason;
  /** Provider-fidelity payload, kept as-is and restored verbatim. */
  fidelity?: Fidelity;
}

export interface ToolCallPayload {
  type: "tool_call";
  role: "assistant";
  name: string;
  /** Tool arguments as a JSON string. */
  arguments: string;
  tool_call_id: string;
  stop_reason?: StopReason;
  /** Provider-fidelity payload, kept as-is and restored verbatim. */
  fidelity?: Fidelity;
}

export interface ToolCallOutputPayload {
  type: "tool_call_output";
  role: "user";
  output: string;
  /**
   * Images carried by the tool output (optional): each is a `data:<mime>;base64,...` data URL,
   * fed back to the model alongside the text (e.g. images read by read_image). Images aren't
   * incremental: the streaming path carries the whole set once via a single delta (see
   * `PartialToolCallOutputPayload.images`), and the complete message carries them again — the
   * streamed-and-joined result equals the complete message.
   */
  images?: string[];
  tool_call_id: string;
  stop_reason?: StopReason;
}

// ---------------------------------------------------------------------------
// model_msg — streaming partial_* messages
// ---------------------------------------------------------------------------
// Docs: /docs/omni-message § "model_msg: streaming partials"

export interface PartialTextPayload {
  type: "partial_text";
  role: "assistant";
  event_type: StreamEventType;
  text: string;
  stop_reason?: StopReason;
}

export interface PartialThinkingPayload {
  type: "partial_thinking";
  role: "assistant";
  event_type: StreamEventType;
  thinking: string;
  stop_reason?: StopReason;
}

export interface PartialToolCallPayload {
  type: "partial_tool_call";
  role: "assistant";
  event_type: StreamEventType;
  name: string;
  /** Incremental fragment of the arguments JSON. */
  arguments: string;
  tool_call_id: string;
  stop_reason?: StopReason;
}

export interface PartialToolCallOutputPayload {
  type: "partial_tool_call_output";
  role: "user";
  event_type: StreamEventType;
  output: string;
  /** Images carried by the tool output (optional): images aren't incremental, carried as a whole by a single delta (consistent with the complete message). */
  images?: string[];
  tool_call_id: string;
  stop_reason?: StopReason;
}

// ---------------------------------------------------------------------------
// event_msg
// ---------------------------------------------------------------------------
// Docs: /docs/omni-message § "event_msg"

export interface ApprovalDecisionPayload {
  type: "approval_decision";
  decision: ApprovalDecision;
  tool_call_id: string;
}

export interface AbortPayload {
  type: "abort";
  reason?: string | null;
}

export interface TokenUsagePayload {
  type: "token_usage";
  /** Current Session cumulative token usage. */
  session: TokenCounts;
  /** Token usage for the most recent Request. */
  request: TokenCounts;
}

/**
 * Request boundary event: the boundary of one LLM Request, produced **in pairs** by
 * `context_engine` and written to Trace. `request_end`
 * with `status` of `completed` means the turn has been committed by AgentHub — this is the
 * mechanical criterion Trace replay (Session resumption) uses to determine whether a turn was
 * committed, and it also gives performance analysis a basis for Request latency and turn counts.
 * A compaction request produces this same event pair too (written to Trace only, not streamed).
 */
export interface RequestBeginPayload {
  type: "request_begin";
}

/**
 * The unified retry/failure detail block shared by `request_end` and `compaction_end` —
 * one standard group of fields, stamped by the builders (the way `withOrigin` stamps
 * `origin`) rather than accreting as scattered ad-hoc parameters. Every field is optional
 * and additive: old Traces replay unchanged.
 */
export interface RetryDetail {
  /**
   * Error detail, one name across the stack (`LLMOutcome.errorMessage` internally): present
   * only on non-completed statuses — the real reason behind a retried/failed Request (e.g.
   * `403 … (insufficient_user_quota)`), for observability — the server's error records /
   * Cost center read it here because a retried request never produces an abort event. Not
   * plain `message`: in this protocol "message" means an OmniMessage / model output, and
   * this field is neither. (Traces written before the rename carry it as `message`; nothing
   * reads that field semantically after the fact, so no dual-read is kept.)
   */
  error_message?: string;
  /**
   * 1-based ordinal of this Request within its retry run — the authoritative retry count
   * the CLI/Web display verbatim. Stamped on every non-completed request_end and on a
   * completed one that needed retries; absent on a clean first-try completion (the common
   * case stays noise-free) and in old Traces.
   */
  attempt?: number;
  /**
   * Planned in-run retry wait (ms) — present ONLY when the engine will retry this failure
   * within the same run (status `timeout`/`malformed` with attempts remaining under the
   * applicable cap). Computed by the same formula as the actual backoff sleep
   * (`reconnectDelayMs`), so the announced wait and the real one cannot drift; the Web App
   * renders it as a live countdown to the next attempt. Absent on final failures (an abort
   * follows instead) and on completed requests.
   */
  retry_in_ms?: number;
}

export interface RequestEndPayload extends RetryDetail {
  type: "request_end";
  /** Terminal state of this Request (reuses the six StopReason values, sharing its source with this turn's complete message's stop_reason / LLMOutcome; `auth` is the credentials-failure signal hosts key on). */
  status: StopReason;
}

/** Compaction trigger reason: context threshold / turn-count threshold / user-initiated request. */
export type CompactionReason = "context" | "turns" | "manual";

/** Context compaction mode: summary relay / direct discard. */
export type CompactionMode = "summarize" | "discard";

/**
 * Compaction boundary event, produced **in pairs** by `context_engine`. Between the pair
 * the stream carries only each attempt's `token_usage` and the summary being written as
 * ordinary `partial_text` fragments (or the complete text when nothing streamed) — the
 * compaction request's other raw messages stay Trace-only. Both `reason` and
 * `mode` are carried on both events, for stateless frontend rendering; `status` reuses the
 * six-value `StopReason` protocol (compaction converges to a terminal state, taking
 * `completed` / `failed` / `aborted` in practice — `timeout` / `malformed` are handled internally
 * by the compaction request's existing retry mechanism, collapsing to `failed` once retries are
 * exhausted).
 */
export interface CompactionBeginPayload {
  type: "compaction_begin";
  reason: CompactionReason;
  mode: CompactionMode;
  /** Current context token usage (the most recent token_usage's request.total). */
  context: number;
  /** Session cumulative turn count. */
  turns: number;
}

/**
 * Inherits the shared RetryDetail block: `attempt` is the final attempt's 1-based ordinal
 * (failed attempts and retries included — stamped by summarize mode), `error_message` is
 * the last failure's detail (present only when `status` is `failed`), and `retry_in_ms` is
 * never stamped here (compaction retries are announced on the compaction request's own
 * request_end, which is Trace-only).
 */
export interface CompactionEndPayload extends RetryDetail {
  type: "compaction_end";
  reason: CompactionReason;
  mode: CompactionMode;
  /** Compaction result; non-`completed` means compaction was abandoned and the original context was kept. */
  status: StopReason;
}

/** How a goal ended: the goal file's terminal status, or `aborted` when a round was cut off. */
export type GoalOutcomeStatus = "complete" | "blocked" | "budget_limited" | "aborted";

/**
 * Goal terminal event: the last message of a goal-mode `session.run` (produced by the
 * Session's goal loop, written to the Trace best-effort). Hosts read the outcome from the
 * stream — the CLI's summary line, the Web server's goal_finished SSE event and run-state
 * persistence all map from this one message.
 */
export interface GoalFinishedPayload {
  type: "goal_finished";
  outcome: GoalOutcomeStatus;
  /** Rounds actually run (the wrap-up round counts). */
  rounds: number;
  /** The loop's own accounting: uncached input + output across every round (subagents included). */
  tokens_used: number;
}

/**
 * Subagent pointer event: when the parent Session spawns a
 * **direct** child session, `context_engine` writes this to the parent Trace (not streamed),
 * recording only the child session's Session id — the child session's other details live in its
 * own Trace's `session_meta`. When the session is reopened, the server uses this to recursively
 * expand the child Trace and reconstruct the `origin` chain; a grandchild session's pointer is
 * recorded by the child Trace itself.
 */
export interface SubagentPayload {
  type: "subagent";
  /** The direct child session's Session id. */
  session_id: string;
}

/**
 * The Session's tool definitions (full schema, matching what is sent to the LLM), emitted
 * once per Session at the start of the first run — after the MCP servers (if any) have
 * connected and their tools were discovered. Split out of `session_meta` so Session
 * creation never blocks on MCP connects: the meta streams immediately and this event
 * follows once the toolset is known. Written to the Trace right after the run's input
 * (so it belongs to the new turn; also rewritten at the head of each post-compaction
 * file alongside `session_meta`) but not part of reload history — live streams re-emit
 * it on the next run, which is when frontends need the schemas.
 * Docs: /docs/omni-message § "event_msg".
 */
export interface ToolListReadyPayload {
  type: "tool_list_ready";
  tools: ToolDefinition[];
}

/** Terminal status of the MCP connect phase (and of each server inside it) — the same style as `compaction_end.status`. */
export type McpConnectStatus = "completed" | "failed" | "aborted";

/** One MCP server's outcome inside `mcp_connect_end.results`; `duration_ms` covers that server's connect + tool discovery (individual servers have no messages of their own to derive it from). */
export interface McpServerConnectResult {
  server: string;
  transport: "stdio" | "http" | "sse";
  status: McpConnectStatus;
  duration_ms: number;
  /** Number of tools discovered (present on completed). */
  tools?: number;
  /** Failure detail (present on failed). */
  error?: string;
}

/**
 * MCP connect boundary events: one pair around the first run's connect + discovery phase,
 * emitted only when MCP Servers are configured. The begin lists the servers being
 * contacted (frontends show a connecting status off it); the end carries the overall
 * `status` (compaction_end-style) plus the per-server results — the phase's total wall
 * time is the pair's timestamp difference (messages carry timestamps, so the payload
 * records no duplicate duration). Failures are per-server and non-fatal: an unreachable
 * server is skipped — its tools are absent — and the run continues. `status: "aborted"`
 * means the user interrupted mid-connect: the attempt is cancelled and the next run
 * reconnects from scratch. Streamed live; written to the Trace right after the run's
 * input so the phase belongs to the new turn (an attempt aborted before the engine
 * exists is live-only). Not part of reload history (a transient status, unlike
 * `tool_list_ready`).
 * Docs: /docs/omni-message § "event_msg".
 */
export interface McpConnectBeginPayload {
  type: "mcp_connect_begin";
  servers: string[];
}

export interface McpConnectEndPayload {
  type: "mcp_connect_end";
  /** Overall terminal status: completed (every server connected) / failed (some server failed) / aborted (user interrupted). */
  status: McpConnectStatus;
  /** Per-server outcomes (empty on an aborted attempt — nothing settled is claimed). */
  results: McpServerConnectResult[];
}

// ---------------------------------------------------------------------------
// Union types and the message envelope
// ---------------------------------------------------------------------------

/** Complete model_msg payload (written to Trace and exposed externally). */
export type CompleteModelPayload =
  | TextPayload
  | ImageUrlPayload
  | InlineDataPayload
  | ThinkingPayload
  | InlineThinkingPayload
  | ToolCallPayload
  | ToolCallOutputPayload;

/** Streaming model_msg payload. */
export type PartialModelPayload =
  | PartialTextPayload
  | PartialThinkingPayload
  | PartialToolCallPayload
  | PartialToolCallOutputPayload;

export type ModelPayload = CompleteModelPayload | PartialModelPayload;

export type EventPayload =
  | ApprovalDecisionPayload
  | AbortPayload
  | RequestBeginPayload
  | RequestEndPayload
  | TokenUsagePayload
  | CompactionBeginPayload
  | CompactionEndPayload
  | GoalFinishedPayload
  | SubagentPayload
  | ToolListReadyPayload
  | McpConnectBeginPayload
  | McpConnectEndPayload;

export type OmniPayload = SessionMetaPayload | ModelPayload | EventPayload;

/** The unified message envelope. */
export interface OmniMessage<P extends OmniPayload = OmniPayload> {
  /** ISO 8601 UTC timestamp. */
  timestamp: string;
  type: OmniMessageType;
  payload: P;
  /** Nested-origin marker: the chain of child Session ids ordered outer-to-inner; absent = from the main Session (see MessageOrigin). */
  origin?: MessageOrigin[];
}

// Convenience aliases for concrete message types --------------------------------

export type SessionMetaMessage = OmniMessage<SessionMetaPayload>;
export type ModelMessage = OmniMessage<ModelPayload>;
export type EventMessage = OmniMessage<EventPayload>;
export type CompleteModelMessage = OmniMessage<CompleteModelPayload>;
export type PartialModelMessage = OmniMessage<PartialModelPayload>;

// ---------------------------------------------------------------------------
// Runtime discrimination helpers
// ---------------------------------------------------------------------------

/** The set of type values for streaming partial_* payloads. */
const PARTIAL_PAYLOAD_TYPES = [
  "partial_text",
  "partial_thinking",
  "partial_tool_call",
  "partial_tool_call_output",
] as const;

export function isPartialPayload(p: OmniPayload): p is PartialModelPayload {
  return (PARTIAL_PAYLOAD_TYPES as readonly string[]).includes((p as { type?: string }).type ?? "");
}

export function isModelMessage(msg: OmniMessage): msg is ModelMessage {
  return msg.type === "model_msg";
}

export function isEventMessage(msg: OmniMessage): msg is EventMessage {
  return msg.type === "event_msg";
}

export function isSessionMeta(msg: OmniMessage): msg is SessionMetaMessage {
  return msg.type === "session_meta";
}

/** A complete model_msg (not partial_*), i.e. a message that can be written to Trace. */
export function isCompleteModelMessage(msg: OmniMessage): msg is CompleteModelMessage {
  return msg.type === "model_msg" && !isPartialPayload(msg.payload);
}
