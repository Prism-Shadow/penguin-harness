/**
 * AMSP's records and control frames, as far as the /amsp page reads them: the scripted runs
 * (amsp-demo.ts) are typed on them and the replay fold (amsp-replay.ts) narrows on them. The
 * payloads the page reads field by field are spelled out, mirroring the AMSP record types
 * (packages/amsp/src/records/types.ts), `task_begin` / `task_end` and `request_begin.thinking_level`
 * included; every other kind of the vocabulary is accepted with its fields unread. The control
 * frames take the SDK's shape (`{ kind, … }`).
 *
 * Page-local on purpose: `@prismshadow/amsp` 0.2.16 still ships the old event types. Once the
 * release after it carries these, this file re-exports them from there and the scripted runs are
 * checked against the real protocol.
 */
import type { EventKind, ModelKind } from "./amsp-vocabulary";

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

export interface RequestBeginPayload {
  type: "request_begin";
  /** The level the engine passed for this request; absent when it passed none. */
  thinking_level?: ThinkingLevel;
}

export interface RequestEndPayload {
  type: "request_end";
  status: StopReason;
  error_code?: string;
  error_message?: string;
  attempt?: number;
  /** Present when the engine will retry: the request did not end the run. */
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

/** A Task's two boundary records carry their type only: its outcome is read from the records. */
type ReadEventPayload =
  | { type: "task_begin" }
  | { type: "task_end" }
  | { type: "abort"; reason?: string | null; error_code?: string; error_message?: string }
  | RequestBeginPayload
  | RequestEndPayload
  | TokenUsagePayload
  | ApprovalDecisionPayload
  | ToolListReadyPayload;

export type EventPayload = ReadEventPayload | Unread<Exclude<EventKind, ReadEventPayload["type"]>>;

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
export type AmspControl = { kind: "resync_required" } | { kind: "ping" };
