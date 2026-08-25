/**
 * OmniMessage builders. All modules create messages exclusively through these builders, avoiding
 * ad hoc protocol structures scattered across the codebase.
 * Every builder writes an ISO 8601 UTC timestamp.
 * Docs: /docs/omni-message § "Builders and guards".
 */
import type {
  AbortCode,
  AbortPayload,
  ApprovalDecision,
  ApprovalDecisionPayload,
  CompactionBeginPayload,
  CompactionEndPayload,
  CompactionMode,
  CompactionReason,
  EventMessage,
  Fidelity,
  GoalFinishedPayload,
  GoalOutcomeStatus,
  ImageUrlPayload,
  InlineDataPayload,
  InlineThinkingPayload,
  McpConnectBeginPayload,
  McpConnectEndPayload,
  McpServerConnectResult,
  MessageOrigin,
  ModelMessage,
  OmniMessage,
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
  TextPayload,
  TextSender,
  ThinkingPayload,
  TokenCounts,
  TokenUsagePayload,
  ToolCallOutputPayload,
  ToolListReadyPayload,
  ToolCallPayload,
  ToolDefinition,
} from "./types.js";

/** The current moment's ISO 8601 UTC timestamp. */
function nowIso(): string {
  return new Date().toISOString();
}

function model<P extends ModelMessage["payload"]>(payload: P): OmniMessage<P> {
  return { timestamp: nowIso(), type: "model_msg", payload };
}

function event<P extends EventMessage["payload"]>(payload: P): OmniMessage<P> {
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
 * parameter object alongside `stopReason`. An empty object is treated as absent — the
 * payload field is only set when the fidelity carries at least one key.
 */
function fidelityProp(fidelity?: Fidelity): { fidelity?: Fidelity } {
  return fidelity !== undefined && Object.keys(fidelity).length > 0 ? { fidelity } : {};
}

export function textMessage(
  role: Role,
  text: string,
  stopReason: StopReason = "completed",
  fidelity?: Fidelity,
): OmniMessage<TextPayload> {
  return model({
    type: "text",
    role,
    text,
    stop_reason: stopReason,
    ...fidelityProp(fidelity),
  });
}

/** User-role text. `sender` marks non-human origins (the parent agent's subagent prompt, a harness or server injection); omitted = the human user, and the field stays absent. */
export const userText = (text: string, sender?: TextSender): OmniMessage<TextPayload> => {
  const msg = textMessage("user", text);
  if (sender !== undefined && sender !== "user") msg.payload.sender = sender;
  return msg;
};

export const assistantText = (
  text: string,
  stopReason: StopReason = "completed",
  fidelity?: Fidelity,
): OmniMessage<TextPayload> => textMessage("assistant", text, stopReason, fidelity);

export function imageUrlMessage(imageUrl: string): OmniMessage<ImageUrlPayload> {
  return model({
    type: "image_url",
    role: "user",
    image_url: imageUrl,
    stop_reason: "completed",
  });
}

export function inlineData(
  role: Role,
  data: string,
  mimeType: string,
  fidelity?: Fidelity,
): OmniMessage<InlineDataPayload> {
  return model({
    type: "inline_data",
    role,
    data,
    mime_type: mimeType,
    stop_reason: "completed",
    ...fidelityProp(fidelity),
  });
}

export function thinkingMessage(
  thinking: string,
  stopReason: StopReason = "completed",
  fidelity?: Fidelity,
): OmniMessage<ThinkingPayload> {
  return model({
    type: "thinking",
    role: "assistant",
    thinking,
    stop_reason: stopReason,
    ...fidelityProp(fidelity),
  });
}

export function inlineThinking(
  data: string,
  mimeType: string,
  fidelity?: Fidelity,
): OmniMessage<InlineThinkingPayload> {
  return model({
    type: "inline_thinking",
    role: "assistant",
    data,
    mime_type: mimeType,
    stop_reason: "completed",
    ...fidelityProp(fidelity),
  });
}

export function toolCall(args: {
  name: string;
  arguments: string;
  toolCallId: string;
  stopReason?: StopReason;
  fidelity?: Fidelity;
}): OmniMessage<ToolCallPayload> {
  return model({
    type: "tool_call",
    role: "assistant",
    name: args.name,
    arguments: args.arguments,
    tool_call_id: args.toolCallId,
    stop_reason: args.stopReason ?? "completed",
    ...fidelityProp(args.fidelity),
  });
}

export function toolCallOutput(args: {
  output: string;
  toolCallId: string;
  stopReason?: StopReason;
  /** Images carried by the tool output (array of data URLs); images aren't incremental — a single delta carries the whole set in the streaming path, and the complete message carries them too. */
  images?: string[];
}): OmniMessage<ToolCallOutputPayload> {
  return model({
    type: "tool_call_output",
    role: "user",
    output: args.output,
    ...(args.images !== undefined && args.images.length > 0 ? { images: args.images } : {}),
    tool_call_id: args.toolCallId,
    stop_reason: args.stopReason ?? "completed",
  });
}

// Streaming partial_* model_msg -------------------------------------------------

export function partialText(
  eventType: StreamEventType,
  text = "",
  stopReason: StopReason = "completed",
): OmniMessage<PartialTextPayload> {
  return model({
    type: "partial_text",
    role: "assistant",
    event_type: eventType,
    text,
    stop_reason: stopReason,
  });
}

export function partialThinking(
  eventType: StreamEventType,
  thinking = "",
  stopReason: StopReason = "completed",
): OmniMessage<PartialThinkingPayload> {
  return model({
    type: "partial_thinking",
    role: "assistant",
    event_type: eventType,
    thinking,
    stop_reason: stopReason,
  });
}

export function partialToolCall(args: {
  eventType: StreamEventType;
  name: string;
  arguments?: string;
  toolCallId: string;
  stopReason?: StopReason;
}): OmniMessage<PartialToolCallPayload> {
  return model({
    type: "partial_tool_call",
    role: "assistant",
    event_type: args.eventType,
    name: args.name,
    arguments: args.arguments ?? "",
    tool_call_id: args.toolCallId,
    stop_reason: args.stopReason ?? "completed",
  });
}

export function partialToolCallOutput(args: {
  eventType: StreamEventType;
  output?: string;
  toolCallId: string;
  stopReason?: StopReason;
  /** Images carried by the tool output (array of data URLs); images aren't incremental — a single delta carries the whole set. */
  images?: string[];
}): OmniMessage<PartialToolCallOutputPayload> {
  return model({
    type: "partial_tool_call_output",
    role: "user",
    event_type: args.eventType,
    output: args.output ?? "",
    ...(args.images !== undefined && args.images.length > 0 ? { images: args.images } : {}),
    tool_call_id: args.toolCallId,
    stop_reason: args.stopReason ?? "completed",
  });
}

// event_msg -------------------------------------------------------------------

export function approvalDecision(
  decision: ApprovalDecision,
  toolCallId: string,
): OmniMessage<ApprovalDecisionPayload> {
  return event({ type: "approval_decision", decision, tool_call_id: toolCallId });
}

export function abortEvent(
  reason: string | null = null,
  extra?: { code?: AbortCode; detail?: string; attempts?: number },
): OmniMessage<AbortPayload> {
  return event({
    type: "abort",
    reason,
    ...(extra?.code !== undefined ? { code: extra.code } : {}),
    ...(extra?.detail !== undefined ? { detail: extra.detail } : {}),
    ...(extra?.attempts !== undefined ? { attempts: extra.attempts } : {}),
  });
}

/** request begin event: marks the start of one LLM Request. */
export function requestBegin(): OmniMessage<RequestBeginPayload> {
  return event({ type: "request_begin" });
}

/**
 * request end event: carries the terminal state (`completed` means this turn was already
 * committed to AgentHub), plus the unified retry detail block (see RequestRetryDetail):
 * the error detail (from LLMOutcome.errorMessage), the 1-based attempt ordinal, and — when the
 * engine will retry in-run — the planned backoff wait (`retry_in_ms`, rendered by the Web
 * App as a live countdown). This builder is the one place the block is stamped.
 */
export function requestEnd(
  status: StopReason,
  retry: { errorMessage?: string; attempt?: number; retryInMs?: number } = {},
): OmniMessage<RequestEndPayload> {
  return event({
    type: "request_end",
    status,
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
}): OmniMessage<CompactionBeginPayload> {
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
  errorMessage?: string;
}): OmniMessage<CompactionEndPayload> {
  return event({
    type: "compaction_end",
    reason: args.reason,
    mode: args.mode,
    status: args.status,
    ...(args.attempt !== undefined ? { attempt: args.attempt } : {}),
    ...(args.errorMessage !== undefined ? { error_message: args.errorMessage } : {}),
  });
}

/** Goal terminal event: the last message of a goal-mode run (produced by the Session's goal loop). */
export function goalFinished(
  outcome: GoalOutcomeStatus,
  rounds: number,
  tokensUsed: number,
): OmniMessage<GoalFinishedPayload> {
  return event({ type: "goal_finished", outcome, rounds, tokens_used: tokensUsed });
}

/** subagent derivation pointer event: records only the direct child session's Session id (written to the parent Trace by context_engine). */
export function subagentEvent(sessionId: string): OmniMessage<SubagentPayload> {
  return event({ type: "subagent", session_id: sessionId });
}

export function emptyTokenCounts(): TokenCounts {
  return { cache_read: 0, cache_write: 0, output: 0, total: 0 };
}

export function tokenUsage(
  session: TokenCounts,
  request: TokenCounts,
): OmniMessage<TokenUsagePayload> {
  return event({ type: "token_usage", session, request });
}

/** tool_list_ready event: the Session's full tool definitions, emitted once the toolset is known (first run, after MCP discovery). */
export function toolListReady(tools: ToolDefinition[]): OmniMessage<ToolListReadyPayload> {
  return event({ type: "tool_list_ready", tools });
}

/** mcp_connect begin event: brackets open on the first run's MCP connect + discovery phase (emitted only when servers are configured). */
export function mcpConnectBegin(servers: string[]): OmniMessage<McpConnectBeginPayload> {
  return event({ type: "mcp_connect_begin", servers });
}

/** mcp_connect end event: overall status (shared StopReason vocabulary) + per-server outcomes; total wall time = end timestamp − begin timestamp. */
export function mcpConnectEnd(args: {
  status: StopReason;
  results: McpServerConnectResult[];
}): OmniMessage<McpConnectEndPayload> {
  return event({ type: "mcp_connect_end", status: args.status, results: args.results });
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
export function withOrigin<M extends OmniMessage>(msg: M, sessionId: MessageOrigin): M {
  return { ...msg, origin: [sessionId, ...(msg.origin ?? [])] };
}
