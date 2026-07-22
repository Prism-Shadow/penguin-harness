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
 * The reason a model response or message generation ended. Only five protocol values are
 * allowed:
 *   - `completed`: finished normally, including completed text, thinking, tool requests, or
 *     tool output;
 *   - `failed`: a non-retryable error or tool execution failure;
 *   - `aborted`: user-initiated interruption or cancellation;
 *   - `timeout`: LLM request timed out;
 *   - `malformed`: the LLM response was malformed (e.g. AgentHub JSON parsing exception).
 *     Only LLM timeout / malformed trigger a context_engine reconnect.
 * Docs: /docs/omni-message § "stop_reason".
 */
export type StopReason = "completed" | "failed" | "aborted" | "timeout" | "malformed";

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

export interface SessionMetaPayload {
  session_id: string;
  /** The session model's provider group (paired with `model_id` to form a model reference). */
  provider: string;
  /** The session model's upstream model_id (the request id sent to AgentHub; paired with `provider`). */
  model_id: string;
  model_context_window: number | string;
  /** The system prompt actually used by this Session (the assembled result with environment placeholders already substituted). */
  system_prompt: string;
  /** The list of tool definitions this Session exposes to the model (full schema, matching what's sent to the LLM). */
  tools: ToolDefinition[];
  /** The model's thinking level (from system_config.model.thinking_level; "default" when unconfigured). */
  thinking_level: string;
  /** Absolute path to the Agent State. */
  agent_state: string;
  /** Absolute path to the Workspace. */
  workspace: string;
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

export interface TextPayload {
  type: "text";
  role: Role;
  text: string;
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

export interface RequestEndPayload {
  type: "request_end";
  /** Terminal state of this Request (reuses the five StopReason values, sharing its source with this turn's complete message's stop_reason / LLMOutcome). */
  status: StopReason;
}

/** Compaction trigger reason: context threshold / turn-count threshold / user-initiated request. */
export type CompactionReason = "context" | "turns" | "manual";

/** Context compaction mode: summary relay / direct discard. */
export type CompactionMode = "summarize" | "discard";

/**
 * Compaction boundary event: the compaction process exposes
 * only this event pair to Human, produced **in pairs** by `context_engine`. Both `reason` and
 * `mode` are carried on both events, for stateless frontend rendering; `status` reuses the
 * five-value `StopReason` protocol (compaction converges to a terminal state, taking
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

export interface CompactionEndPayload {
  type: "compaction_end";
  reason: CompactionReason;
  mode: CompactionMode;
  /** Compaction result; non-`completed` means compaction was abandoned and the original context was kept. */
  status: StopReason;
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
  | SubagentPayload;

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
