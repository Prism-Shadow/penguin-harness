/**
 * AMSP (Agent Message Stream Protocol): the wire types.
 *
 * MMSP streams one model call; AMSP streams one run of an Agent — one Task — on a Session the
 * caller continues by id. A run is a `text/event-stream` of `data: <JSON>` blocks, one event
 * each, closed by `data: [DONE]`:
 *
 *   stream := run.started body* run.done
 *
 * Events are flat objects discriminated by `type`, snake_case on the wire like MMSP and the
 * OmniMessage payloads they are projected from. `run.done` is the one terminal event and always
 * arrives, errors included. Clients must ignore a `type` they do not know: new event types and
 * optional fields are additive within `/v1`; a change to an existing field's meaning is `/v2`.
 *
 * The server's translator produces these events and imports this file as types; the client
 * consumes them.
 */

// ---- vocabulary shared with OmniMessage (same strings, same meaning) ----
export type StopReason = "completed" | "aborted" | "retryable" | "fatal";
export type Role = "user" | "assistant";
export type ApprovalDecision = "allow" | "deny" | "forbidden";
export type Sender = "user" | "parent_agent" | "harness" | "server";
export type CompactionReason = "context" | "turns" | "manual";
export type CompactionMode = "summarize" | "discard";
export type HookPoint = "stop" | "pre_tool_use" | "user_prompt";
export type HookDecision = "continue" | "stop" | "allow" | "deny";
export type SessionStatus = "idle" | "running" | "compacting";

export interface TokenCounts {
  cache_read: number;
  cache_write: number;
  output: number;
  total: number;
}
/** The one error shape: `code` snake_case and stable (OmniMessage ErrorCode values plus AMSP's own, listed in the protocol reference); `message` raw text. */
export interface AmspError {
  code: string;
  message: string;
}
export interface ToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}
export interface McpServerResult {
  server: string;
  transport: "stdio" | "http" | "sse";
  status: StopReason;
  duration_ms: number;
  tools?: number;
  error?: AmspError;
}

interface Base {
  /** ISO 8601 UTC. */
  at: string;
  /** Child-Session chain, outer→inner (OmniMessage `origin`); absent = the main Session. */
  origin?: string[];
}

// ---- run layer ----
export interface RunStarted extends Base {
  type: "run.started";
  session_id: string;
  agent: string /* "<projectId>/<agentId>" */;
}
export interface RunDone extends Base {
  type: "run.done";
  status: StopReason;
  error?: AmspError;
  /** Model Requests this run issued (attempts included). */
  requests: number;
  usage: TokenCounts;
  session_usage: TokenCounts | null;
}

// ---- context / bootstrap ----
export interface ContextOpened extends Base {
  type: "context.opened";
  session_id: string;
  provider: string;
  model_id: string;
  context_window: number | "unknown";
}
export interface McpConnectStarted extends Base {
  type: "mcp_connect.started";
  servers: string[];
}
export interface McpConnectDone extends Base {
  type: "mcp_connect.done";
  status: StopReason;
  results: McpServerResult[];
  error?: AmspError;
}
export interface ToolsReady extends Base {
  type: "tools.ready";
  tools: ToolDefinition[];
}

// ---- request layer ----
export interface RequestStarted extends Base {
  type: "request.started";
  request: number /* 1-based within the run */;
}
export interface RequestDone extends Base {
  type: "request.done";
  request: number;
  status: StopReason;
  usage: TokenCounts | null;
  error?: AmspError;
  /** 1-based attempt ordinal; present on retries and failures (OmniMessage `attempt`). */
  attempt?: number;
  /** Present only when the engine will retry this failure within the run. */
  retry_in_ms?: number;
}

// ---- item layer: fragments ----
export interface TextDelta extends Base {
  type: "text.delta";
  role: "assistant";
  text: string;
}
export interface ThinkingDelta extends Base {
  type: "thinking.delta";
  thinking: string;
}
export interface ToolCallDelta extends Base {
  type: "tool_call.delta";
  tool_call_id: string;
  /** Set on the first fragment; may be empty afterwards. */
  name: string;
  /** A fragment of the arguments JSON string. */
  arguments: string;
}
export interface ToolResultDelta extends Base {
  type: "tool_result.delta";
  tool_call_id: string;
  output: string;
  /** Not incremental: one fragment carries the whole set. */
  images?: string[];
}
export interface SummaryDelta extends Base {
  type: "summary.delta";
  text: string;
}

// ---- item layer: complete items ----
export interface TextDone extends Base {
  type: "text.done";
  role: Role;
  text: string;
  stop_reason: StopReason;
  /** On user-role texts the harness injected mid-run. */
  sender?: Sender;
}
export interface ThinkingDone extends Base {
  type: "thinking.done";
  thinking: string;
  stop_reason: StopReason;
}
export interface ToolCallDone extends Base {
  type: "tool_call.done";
  tool_call_id: string;
  name: string;
  /** The complete arguments as a JSON string — identical to the concatenated deltas; parse with `parseArguments`. */
  arguments: string;
  stop_reason: StopReason;
}
export interface ToolResultDone extends Base {
  type: "tool_result.done";
  tool_call_id: string;
  output: string;
  images?: string[];
  stop_reason: StopReason;
}
export interface InlineDataDone extends Base {
  type: "inline_data.done";
  role: Role;
  mime_type: string;
  /** base64 */
  data: string;
  stop_reason: StopReason;
}
export interface InlineThinkingDone extends Base {
  type: "inline_thinking.done";
  mime_type: string;
  data: string;
  stop_reason: StopReason;
}
export interface ImageUrlDone extends Base {
  type: "image_url.done";
  role: "user";
  image_url: string;
}
export interface SummaryDone extends Base {
  type: "summary.done";
  text: string;
  stop_reason: StopReason;
}

// ---- approvals ----
export interface ApprovalRequested extends Base {
  type: "approval.requested";
  tool_call: { tool_call_id: string; name: string; arguments: string };
}
export interface ApprovalDecided extends Base {
  type: "approval.decided";
  tool_call_id: string;
  decision: ApprovalDecision;
}

// ---- compaction ----
export interface CompactionStarted extends Base {
  type: "compaction.started";
  reason: CompactionReason;
  mode: CompactionMode;
  context: number;
  turns: number;
}
export interface CompactionDone extends Base {
  type: "compaction.done";
  reason: CompactionReason;
  mode: CompactionMode;
  status: StopReason;
  usage: TokenCounts | null;
  error?: AmspError;
  attempt?: number;
}

// ---- hooks ----
export interface HookFired extends Base {
  type: "hook.fired";
  hook: HookPoint;
  name: string;
  decision?: HookDecision;
  reason?: string;
  output?: Record<string, string | number | boolean>;
}

export type AmspEvent =
  | RunStarted
  | RunDone
  | ContextOpened
  | McpConnectStarted
  | McpConnectDone
  | ToolsReady
  | RequestStarted
  | RequestDone
  | TextDelta
  | ThinkingDelta
  | ToolCallDelta
  | ToolResultDelta
  | SummaryDelta
  | TextDone
  | ThinkingDone
  | ToolCallDone
  | ToolResultDone
  | InlineDataDone
  | InlineThinkingDone
  | ImageUrlDone
  | SummaryDone
  | ApprovalRequested
  | ApprovalDecided
  | CompactionStarted
  | CompactionDone
  | HookFired;

// ---- requests / responses ----
export type InputItem =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: string /* data: URL or http(s) URL */ };
export interface RunRequest {
  session_id?: string;
  input: string | InputItem[];
}
export interface AgentInfo {
  id: string /* "<projectId>/<agentId>" */;
  name?: string;
  description?: string;
}
export interface AgentResponse {
  agent: AgentInfo;
}
export interface SessionInfo {
  id: string;
  agent: string;
  status: SessionStatus;
  provider: string;
  model_id: string;
  created_at: string;
  last_active_at: string;
}
export interface SessionResponse {
  session: SessionInfo;
}
export interface ApprovalRequest {
  decision: "allow" | "deny";
}
export interface ErrorResponse {
  error: AmspError;
}
