/**
 * AMSP v2's envelope, as far as the /amsp page reads it: the scripted runs (amsp-demo.ts) are
 * typed on it and the replay fold (amsp-replay.ts) narrows on it. The payloads the page reads
 * field by field are spelled out, mirroring core's OmniMessage types (packages/core/src/omnimessage
 * /types.ts) plus v2's additions — `task_begin`/`task_end`, `request_begin.thinking_level` and the
 * `server_event` envelope; every other kind of the vocabulary is accepted with its fields unread.
 *
 * Page-local on purpose: `@prismshadow/amsp` still ships v1 until SDK 1.0, which carries these
 * types. Once it does, this file re-exports them from there and the scripted runs are checked
 * against the real protocol.
 */
import type { EventKind, ModelKind, ServerEventKind } from "./amsp-vocabulary";

/** How a message, a request, a compaction or a task ended. */
export type StopReason = "completed" | "aborted" | "retryable" | "fatal";

/** The phase of a streaming fragment. */
export type StreamPhase = "start" | "delta" | "stop";

export type ThinkingLevel = "none" | "low" | "medium" | "high" | "xhigh" | "max";

export interface TokenCounts {
  cache_read: number;
  cache_write: number;
  output: number;
  total: number;
}

/** A kind of the vocabulary whose fields this page never reads. */
interface Unread<K extends string> {
  type: K;
  [field: string]: unknown;
}

export interface SessionMetaPayload {
  session_id: string;
  provider: string;
  model_id: string;
  model_context_window: number | string;
  system_prompt: string;
  agent_state: string;
  workspace: string;
  source: "user" | "api" | "schedule" | "subagent" | "cli" | "company" | "workbench";
}

export interface TextPayload {
  type: "text";
  role: "user" | "assistant";
  text: string;
  stop_reason?: StopReason;
}

export interface ThinkingPayload {
  type: "thinking";
  role: "assistant";
  thinking: string;
  stop_reason?: StopReason;
}

export interface ToolCallPayload {
  type: "tool_call";
  role: "assistant";
  name: string;
  arguments: string;
  tool_call_id: string;
  stop_reason?: StopReason;
}

export interface ToolCallOutputPayload {
  type: "tool_call_output";
  role: "user";
  output: string;
  tool_call_id: string;
  stop_reason?: StopReason;
}

export interface PartialTextPayload {
  type: "partial_text";
  role: "assistant";
  event_type: StreamPhase;
  text: string;
  stop_reason?: StopReason;
}

export interface PartialThinkingPayload {
  type: "partial_thinking";
  role: "assistant";
  event_type: StreamPhase;
  thinking: string;
  stop_reason?: StopReason;
}

export interface PartialToolCallPayload {
  type: "partial_tool_call";
  role: "assistant";
  event_type: StreamPhase;
  name: string;
  arguments: string;
  tool_call_id: string;
  stop_reason?: StopReason;
}

export interface PartialToolCallOutputPayload {
  type: "partial_tool_call_output";
  role: "user";
  event_type: StreamPhase;
  output: string;
  tool_call_id: string;
  stop_reason?: StopReason;
}

type ReadModelPayload =
  | TextPayload
  | ThinkingPayload
  | ToolCallPayload
  | ToolCallOutputPayload
  | PartialTextPayload
  | PartialThinkingPayload
  | PartialToolCallPayload
  | PartialToolCallOutputPayload;

export type ModelPayload = ReadModelPayload | Unread<Exclude<ModelKind, ReadModelPayload["type"]>>;

export interface TaskEndPayload {
  type: "task_end";
  status: StopReason;
}

export interface RequestBeginPayload {
  type: "request_begin";
  /** The level the engine passed for this request; absent when it passed none. */
  thinking_level?: ThinkingLevel;
}

export interface RequestEndPayload {
  type: "request_end";
  status: StopReason;
  attempt?: number;
  retry_in_ms?: number;
}

export interface TokenUsagePayload {
  type: "token_usage";
  session: TokenCounts;
  request: TokenCounts;
}

export interface ApprovalDecisionPayload {
  type: "approval_decision";
  decision: "allow" | "deny" | "forbidden";
  tool_call_id: string;
}

export interface ToolListReadyPayload {
  type: "tool_list_ready";
  /** Names only in the scripted runs: the descriptions and schemas are long and say nothing here. */
  tools: { name: string }[];
}

type ReadEventPayload =
  | { type: "task_begin" }
  | TaskEndPayload
  | RequestBeginPayload
  | RequestEndPayload
  | TokenUsagePayload
  | ApprovalDecisionPayload
  | ToolListReadyPayload;

export type EventPayload = ReadEventPayload | Unread<Exclude<EventKind, ReadEventPayload["type"]>>;

export interface HelloPayload {
  type: "hello";
  session_id?: string;
  agent?: string;
}

export interface TaskStatePayload {
  type: "task_state";
  state: "running" | "idle";
}

export interface ApprovalRequestPayload {
  type: "approval_request";
  /** The call waiting for an answer, as the complete record the stream already carried. */
  toolCall: ToolCallRecord;
}

type ReadServerPayload = HelloPayload | TaskStatePayload | ApprovalRequestPayload;

export type ServerEventPayload =
  ReadServerPayload | Unread<Exclude<ServerEventKind, ReadServerPayload["type"]>>;

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

export type AmspEvent =
  | Envelope<"session_meta", SessionMetaPayload>
  | Envelope<"model_msg", ModelPayload>
  | Envelope<"event_msg", EventPayload>
  | Envelope<"server_event", ServerEventPayload>;
