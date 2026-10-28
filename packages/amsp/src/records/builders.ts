/**
 * Record builders. All modules create records exclusively through these builders, avoiding
 * ad hoc protocol structures scattered across the codebase.
 * Every builder writes an ISO 8601 UTC timestamp.
 * Docs: /docs/amsp-records § "Builders and guards".
 */
import type {
  ErrorCode,
  AbortPayload,
  ApprovalDecision,
  ApprovalDecisionPayload,
  CompactionBeginPayload,
  CompactionEndPayload,
  CompactionMode,
  CompactionReason,
  EventMessage,
  Fidelity,
  HookPayload,
  ImageUrlPayload,
  InlineDataPayload,
  InlineThinkingPayload,
  McpConnectBeginPayload,
  McpConnectEndPayload,
  McpServerConnectResult,
  MessageOrigin,
  ModelMessage,
  AmspRecord,
  PartialTextPayload,
  PartialThinkingPayload,
  PartialToolCallOutputPayload,
  PartialToolCallPayload,
  RequestBeginPayload,
  RequestEndPayload,
  Role,
  SessionMetaMessage,
  SessionMetaPayload,
  StopReason,
  StreamEventType,
  SubagentPayload,
  TaskBeginPayload,
  TaskEndPayload,
  TextPayload,
  TextSender,
  ThinkingPayload,
  TokenCounts,
  TokenUsagePayload,
  ToolCallOutputPayload,
  ToolListReadyPayload,
  ToolStatus,
  ToolCallPayload,
  ToolDefinition,
  ThinkingLevelName,
} from "./types.js";

/** The current moment's ISO 8601 UTC timestamp. */
function nowIso(): string {
  return new Date().toISOString();
}

function model<P extends ModelMessage["payload"]>(payload: P): AmspRecord<P> {
  return { timestamp: nowIso(), type: "model_msg", payload };
}

function event<P extends EventMessage["payload"]>(payload: P): AmspRecord<P> {
  return { timestamp: nowIso(), type: "event_msg", payload };
}

// session_meta ---------------------------------------------------------------

export function sessionMeta(payload: SessionMetaPayload): SessionMetaMessage {
  return { timestamp: nowIso(), type: "session_meta", payload };
}

// Complete model_msg -----------------------------------------------------------

/**
 * Provider-fidelity payload (opaque, see `Fidelity` in types.ts): kept as-is and restored
 * verbatim on replay. Builder convention: positional-argument-style builders take it as a
 * trailing `fidelity` object; object-argument-style builders (toolCall) carry it in the
 * parameter object. An empty object is treated as absent — the payload field is only set when
 * the fidelity carries at least one key.
 */
function fidelityProp(fidelity?: Fidelity): { fidelity?: Fidelity } {
  return fidelity !== undefined && Object.keys(fidelity).length > 0 ? { fidelity } : {};
}

export function textMessage(
  role: Role,
  text: string,
  fidelity?: Fidelity,
): AmspRecord<TextPayload> {
  return model({ type: "text", role, text, ...fidelityProp(fidelity) });
}

/** User-role text. `sender` marks non-human origins (the parent agent's subagent prompt, a harness or server injection); omitted = the human user, and the field stays absent. */
export const userText = (text: string, sender?: TextSender): AmspRecord<TextPayload> => {
  const msg = textMessage("user", text);
  if (sender !== undefined && sender !== "user") msg.payload.sender = sender;
  return msg;
};

export const assistantText = (text: string, fidelity?: Fidelity): AmspRecord<TextPayload> =>
  textMessage("assistant", text, fidelity);

export function imageUrlMessage(imageUrl: string): AmspRecord<ImageUrlPayload> {
  return model({ type: "image_url", role: "user", image_url: imageUrl });
}

export function inlineData(
  role: Role,
  data: string,
  mimeType: string,
  fidelity?: Fidelity,
): AmspRecord<InlineDataPayload> {
  return model({
    type: "inline_data",
    role,
    data,
    mime_type: mimeType,
    ...fidelityProp(fidelity),
  });
}

export function thinkingMessage(
  thinking: string,
  fidelity?: Fidelity,
): AmspRecord<ThinkingPayload> {
  return model({ type: "thinking", role: "assistant", thinking, ...fidelityProp(fidelity) });
}

export function inlineThinking(
  data: string,
  mimeType: string,
  fidelity?: Fidelity,
): AmspRecord<InlineThinkingPayload> {
  return model({
    type: "inline_thinking",
    role: "assistant",
    data,
    mime_type: mimeType,
    ...fidelityProp(fidelity),
  });
}

export function toolCall(args: {
  name: string;
  arguments: string;
  toolCallId: string;
  fidelity?: Fidelity;
}): AmspRecord<ToolCallPayload> {
  return model({
    type: "tool_call",
    role: "assistant",
    name: args.name,
    arguments: args.arguments,
    tool_call_id: args.toolCallId,
    ...fidelityProp(args.fidelity),
  });
}

/** A complete tool result; `status` says what it is (see ToolStatus) and every caller names it. */
export function toolCallOutput(args: {
  output: string;
  toolCallId: string;
  status: ToolStatus;
  /** Images carried by the tool output (array of data URLs); images aren't incremental — a single delta carries the whole set in the streaming path, and the complete message carries them too. */
  images?: string[];
}): AmspRecord<ToolCallOutputPayload> {
  return model({
    type: "tool_call_output",
    role: "user",
    output: args.output,
    ...(args.images !== undefined && args.images.length > 0 ? { images: args.images } : {}),
    tool_call_id: args.toolCallId,
    status: args.status,
  });
}

// Streaming partial_* model_msg -------------------------------------------------

export function partialText(eventType: StreamEventType, text = ""): AmspRecord<PartialTextPayload> {
  return model({ type: "partial_text", role: "assistant", event_type: eventType, text });
}

export function partialThinking(
  eventType: StreamEventType,
  thinking = "",
): AmspRecord<PartialThinkingPayload> {
  return model({ type: "partial_thinking", role: "assistant", event_type: eventType, thinking });
}

export function partialToolCall(args: {
  eventType: StreamEventType;
  name: string;
  arguments?: string;
  toolCallId: string;
}): AmspRecord<PartialToolCallPayload> {
  return model({
    type: "partial_tool_call",
    role: "assistant",
    event_type: args.eventType,
    name: args.name,
    arguments: args.arguments ?? "",
    tool_call_id: args.toolCallId,
  });
}

export function partialToolCallOutput(args: {
  eventType: StreamEventType;
  output?: string;
  toolCallId: string;
  /** Images carried by the tool output (array of data URLs); images aren't incremental — a single delta carries the whole set. */
  images?: string[];
}): AmspRecord<PartialToolCallOutputPayload> {
  return model({
    type: "partial_tool_call_output",
    role: "user",
    event_type: args.eventType,
    output: args.output ?? "",
    ...(args.images !== undefined && args.images.length > 0 ? { images: args.images } : {}),
    tool_call_id: args.toolCallId,
  });
}

// event_msg -------------------------------------------------------------------

export function approvalDecision(
  decision: ApprovalDecision,
  toolCallId: string,
): AmspRecord<ApprovalDecisionPayload> {
  return event({ type: "approval_decision", decision, tool_call_id: toolCallId });
}

/** abort event: a user interruption (its three codes), or the Task stopped at its turn cap (`max_turns`, with a line naming the cap). */
export function abortEvent(
  errorCode:
    "user_abort" | "backoff_interrupted" | "compaction_interrupted" | "max_turns" = "user_abort",
  errorMessage?: string,
): AmspRecord<AbortPayload> {
  return event({
    type: "abort",
    error_code: errorCode,
    ...(errorMessage !== undefined ? { error_message: errorMessage } : {}),
  });
}

/** Task begin event: opens one Task's pair (produced by the Session; see TaskBeginPayload). */
export function taskBegin(): AmspRecord<TaskBeginPayload> {
  return event({ type: "task_begin" });
}

/** Task end event: closes the Task the last `task_begin` opened (see TaskBeginPayload). */
export function taskEnd(): AmspRecord<TaskEndPayload> {
  return event({ type: "task_end" });
}

/**
 * request begin event: marks the start of one LLM Request, stamped with the effective thinking
 * level the request goes out at (omitted when none is sent).
 */
export function requestBegin(thinkingLevel?: ThinkingLevelName): AmspRecord<RequestBeginPayload> {
  return event({
    type: "request_begin",
    ...(thinkingLevel !== undefined ? { thinking_level: thinkingLevel } : {}),
  });
}

/**
 * request end event: carries the terminal state (`completed` means this turn was already
 * committed to MMSP), plus the unified retry detail block (see RequestRetryDetail):
 * the error detail (from LLMOutcome.errorMessage), the 1-based attempt ordinal, and — when the
 * engine will retry in-run — the planned backoff wait (`retry_in_ms`, rendered by the Web
 * App as a live countdown). This builder is the one place the block is stamped.
 */
export function requestEnd(
  status: StopReason,
  retry: {
    errorCode?: ErrorCode;
    errorMessage?: string;
    attempt?: number;
    retryInMs?: number;
  } = {},
): AmspRecord<RequestEndPayload> {
  return event({
    type: "request_end",
    status,
    ...(retry.errorCode !== undefined ? { error_code: retry.errorCode } : {}),
    ...(retry.errorMessage !== undefined ? { error_message: retry.errorMessage } : {}),
    ...(retry.attempt !== undefined ? { attempt: retry.attempt } : {}),
    ...(retry.retryInMs !== undefined ? { retry_in_ms: retry.retryInMs } : {}),
  });
}

/** compaction begin event: carries the trigger reason, mode, current context usage, and cumulative Session turn count. */
export function compactionBegin(args: {
  reason: CompactionReason;
  mode: CompactionMode;
  context: number;
  turns: number;
}): AmspRecord<CompactionBeginPayload> {
  return event({
    type: "compaction_begin",
    reason: args.reason,
    mode: args.mode,
    context: args.context,
    turns: args.turns,
  });
}

/** compaction end event: carries the compaction result (non-`completed` means compaction was abandoned and the original context is kept), plus its share of the RetryDetail block (final attempt ordinal; last error_message detail on failures). */
export function compactionEnd(args: {
  reason: CompactionReason;
  mode: CompactionMode;
  status: StopReason;
  attempt?: number;
  errorCode?: ErrorCode;
  errorMessage?: string;
}): AmspRecord<CompactionEndPayload> {
  return event({
    type: "compaction_end",
    reason: args.reason,
    mode: args.mode,
    status: args.status,
    ...(args.attempt !== undefined ? { attempt: args.attempt } : {}),
    ...(args.errorCode !== undefined ? { error_code: args.errorCode } : {}),
    ...(args.errorMessage !== undefined ? { error_message: args.errorMessage } : {}),
  });
}

/** Hook result event: what one hook answered at a hook point (produced by the Session's hook loop; see hooks/stop-hook.ts). */
export function hookEvent(payload: Omit<HookPayload, "type">): AmspRecord<HookPayload> {
  return event({ type: "hook", ...payload });
}

/** subagent derivation pointer event: records only the direct child session's Session id (written to the parent Trace by context_engine). */
export function subagentEvent(sessionId: string): AmspRecord<SubagentPayload> {
  return event({ type: "subagent", session_id: sessionId });
}

export function emptyTokenCounts(): TokenCounts {
  return { cache_read: 0, cache_write: 0, output: 0, total: 0 };
}

export function tokenUsage(
  session: TokenCounts,
  request: TokenCounts,
): AmspRecord<TokenUsagePayload> {
  return event({ type: "token_usage", session, request });
}

/** tool_list_ready event: the Session's full tool definitions, emitted once the toolset is known (first run, after MCP discovery). */
export function toolListReady(tools: ToolDefinition[]): AmspRecord<ToolListReadyPayload> {
  return event({ type: "tool_list_ready", tools });
}

/** mcp_connect begin event: brackets open on an MCP connect + discovery phase — the first run's, or a new context's after compaction (emitted only when servers are configured). */
export function mcpConnectBegin(servers: string[]): AmspRecord<McpConnectBeginPayload> {
  return event({ type: "mcp_connect_begin", servers });
}

/** mcp_connect end event: overall status (shared StopReason vocabulary) + per-server outcomes; total wall time = end timestamp − begin timestamp. */
export function mcpConnectEnd(args: {
  status: StopReason;
  results: McpServerConnectResult[];
  errorCode?: ErrorCode;
  errorMessage?: string;
}): AmspRecord<McpConnectEndPayload> {
  return event({
    type: "mcp_connect_end",
    status: args.status,
    results: args.results,
    ...(args.errorCode !== undefined ? { error_code: args.errorCode } : {}),
    ...(args.errorMessage !== undefined ? { error_message: args.errorMessage } : {}),
  });
}

/** Adds two sets of Token counts together, used to maintain cumulative Session usage. */
export function addTokenCounts(a: TokenCounts, b: TokenCounts): TokenCounts {
  return {
    cache_read: a.cache_read + b.cache_read,
    cache_write: a.cache_write + b.cache_write,
    output: a.output + b.output,
    total: a.total + b.total,
  };
}

/**
 * Marks a message with a nested-origin tag: prepends one hop (a child Session id) to the front
 * of `origin`, outer-to-inner.
 * Used by host tools (e.g. run_subagent) when forwarding child-session messages; an absent
 * `origin` means the message comes from the main Session.
 */
export function withOrigin<M extends AmspRecord>(msg: M, sessionId: MessageOrigin): M {
  return { ...msg, origin: [sessionId, ...(msg.origin ?? [])] };
}
