/**
 * AMSP's records and control frames, as the /amsp page reads and shows them: the scripted runs
 * (amsp-demo.ts) and the record reference's examples (amsp-records.ts) are typed on them, and the
 * replay fold (amsp-replay.ts) narrows on them. They mirror the AMSP record types
 * (packages/amsp/src/records/types.ts) as the protocol ships: no record carries a `stop_reason`;
 * a Request's end is `request_end.status`; a tool result says what it is in its own `status`;
 * every streamed message has its complete record, an interrupted one's included. The control
 * frames take the SDK's shape (`{ kind, … }`).
 *
 * Page-local on purpose: `@prismshadow/amsp` 0.2.16 still ships the old event types, and the
 * landing site depends on no protocol package. Once a release carries these, this file re-exports
 * them from there and the scripted runs are checked against the real protocol.
 */
import type { ControlKind } from "./amsp-vocabulary";

/**
 * How an operation ended: a Request (`request_end.status`, the one record of why it ended), a
 * compaction, an MCP connect phase. A response cut off at its output cap is `retryable` with
 * `error_code` `output_truncated`, retried like any retryable failure.
 */
export type StopReason = "completed" | "aborted" | "retryable" | "fatal";

/** What a tool result is: it ran to its end, it failed, or it never ran or was interrupted. */
export type ToolStatus = "completed" | "aborted" | "fatal";

/** The phase of a streaming fragment. */
export type StreamPhase = "start" | "delta" | "stop";

export type ThinkingLevel = "none" | "low" | "medium" | "high" | "xhigh" | "max";

export type Role = "user" | "assistant";

export interface TokenCounts {
  cache_read: number;
  cache_write: number;
  output: number;
  total: number;
}

/** Wire data a provider needs back on replay; opaque to the harness. */
export type Fidelity = Record<string, unknown>;

export type SessionSource =
  "user" | "api" | "schedule" | "subagent" | "cli" | "company" | "workbench";

export interface SessionMetaPayload {
  session_id: string;
  provider: string;
  model_id: string;
  model_context_window: number | string;
  system_prompt: string;
  agent_state: string;
  workspace: string;
  source: SessionSource;
}

// model_msg: complete messages

export interface TextPayload {
  type: "text";
  role: Role;
  text: string;
  sender?: "user" | "parent_agent" | "harness" | "server";
  fidelity?: Fidelity;
}

export interface ImageUrlPayload {
  type: "image_url";
  role: "user";
  image_url: string;
}

export interface InlineDataPayload {
  type: "inline_data";
  role: Role;
  data: string;
  mime_type: string;
  fidelity?: Fidelity;
}

export interface ThinkingPayload {
  type: "thinking";
  role: "assistant";
  thinking: string;
  fidelity?: Fidelity;
}

export interface InlineThinkingPayload {
  type: "inline_thinking";
  role: "assistant";
  data: string;
  mime_type: string;
  fidelity?: Fidelity;
}

export interface ToolCallPayload {
  type: "tool_call";
  role: "assistant";
  name: string;
  arguments: string;
  tool_call_id: string;
  fidelity?: Fidelity;
}

export interface ToolCallOutputPayload {
  type: "tool_call_output";
  role: "user";
  output: string;
  images?: string[];
  tool_call_id: string;
  status: ToolStatus;
}

// model_msg: streaming fragments

export interface PartialTextPayload {
  type: "partial_text";
  role: "assistant";
  event_type: StreamPhase;
  text: string;
}

export interface PartialThinkingPayload {
  type: "partial_thinking";
  role: "assistant";
  event_type: StreamPhase;
  thinking: string;
}

export interface PartialToolCallPayload {
  type: "partial_tool_call";
  role: "assistant";
  event_type: StreamPhase;
  name: string;
  arguments: string;
  tool_call_id: string;
}

export interface PartialToolCallOutputPayload {
  type: "partial_tool_call_output";
  role: "user";
  event_type: StreamPhase;
  output: string;
  images?: string[];
  tool_call_id: string;
}

export type ModelPayload =
  | TextPayload
  | ImageUrlPayload
  | InlineDataPayload
  | ThinkingPayload
  | InlineThinkingPayload
  | ToolCallPayload
  | ToolCallOutputPayload
  | PartialTextPayload
  | PartialThinkingPayload
  | PartialToolCallPayload
  | PartialToolCallOutputPayload;

// event_msg

/** The records' one error vocabulary: a stable code to localize from, and the raw text. */
export interface ErrorInfo {
  error_code?: string;
  error_message?: string;
}

/** The retry detail `request_end` and `compaction_end` share. */
export interface RetryDetail extends ErrorInfo {
  attempt?: number;
  retry_in_ms?: number;
}

export interface TaskBeginPayload {
  type: "task_begin";
}

export interface TaskEndPayload {
  type: "task_end";
}

export interface RequestBeginPayload {
  type: "request_begin";
  thinking_level?: ThinkingLevel;
}

export interface RequestEndPayload extends RetryDetail {
  type: "request_end";
  status: StopReason;
}

export interface TokenUsagePayload {
  type: "token_usage";
  session: TokenCounts;
  request: TokenCounts;
}

export interface AbortPayload extends ErrorInfo {
  type: "abort";
  /** Legacy prose cause, read only when no `error_code` is present. */
  reason?: string | null;
}

export interface ApprovalDecisionPayload {
  type: "approval_decision";
  decision: "allow" | "deny" | "forbidden";
  tool_call_id: string;
}

export interface HookPayload {
  type: "hook";
  hook: "stop" | "pre_tool_use" | "user_prompt";
  name: string;
  decision?: "continue" | "stop" | "allow" | "deny";
  reason?: string;
  output?: Record<string, string | number | boolean>;
}

export interface CompactionBeginPayload {
  type: "compaction_begin";
  reason: "context" | "turns" | "manual";
  mode: "summarize" | "discard";
  context: number;
  turns: number;
}

export interface CompactionEndPayload extends RetryDetail {
  type: "compaction_end";
  reason: "context" | "turns" | "manual";
  mode: "summarize" | "discard";
  status: StopReason;
}

export interface SubagentPayload {
  type: "subagent";
  session_id: string;
}

export interface ToolListReadyPayload {
  type: "tool_list_ready";
  tools: { name: string; description: string; parameters?: Record<string, unknown> }[];
}

export interface McpConnectBeginPayload {
  type: "mcp_connect_begin";
  servers: string[];
}

export interface McpServerConnectResult extends ErrorInfo {
  server: string;
  transport: "stdio" | "http" | "sse";
  status: StopReason;
  duration_ms: number;
  tools?: number;
}

export interface McpConnectEndPayload extends ErrorInfo {
  type: "mcp_connect_end";
  status: StopReason;
  results: McpServerConnectResult[];
}

export type EventPayload =
  | TaskBeginPayload
  | TaskEndPayload
  | RequestBeginPayload
  | RequestEndPayload
  | TokenUsagePayload
  | AbortPayload
  | ApprovalDecisionPayload
  | HookPayload
  | CompactionBeginPayload
  | CompactionEndPayload
  | SubagentPayload
  | ToolListReadyPayload
  | McpConnectBeginPayload
  | McpConnectEndPayload;

interface Envelope<T extends string, P> {
  /** ISO 8601, UTC. */
  timestamp: string;
  type: T;
  payload: P;
  /** The child-Session chain, outer to inner; absent on the main Session's own records. */
  origin?: string[];
}

/** A complete tool call as the stream carries it. */
export type ToolCallRecord = Envelope<"model_msg", ToolCallPayload>;

/** One AMSP record: an SSE event with no name and an `id:`, its data the record's envelope. */
export type AmspRecord =
  | Envelope<"session_meta", SessionMetaPayload>
  | Envelope<"model_msg", ModelPayload>
  | Envelope<"event_msg", EventPayload>;

/** A control frame: an SSE event with a name and no id. `data: [DONE]` ends a run stream. */
export type AmspControl = { kind: ControlKind };
