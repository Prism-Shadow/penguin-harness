/**
 * Records as a Session streams them, built by hand: this package depends on nothing, its tests
 * included. The shapes are the records' (src/records/types.ts); the server's wire suite
 * checks that a real run streams these shapes in this order.
 */
import type { AmspRecord, TokenCounts } from "../../src/index.js";

let clock = Date.parse("2026-10-23T10:00:00.000Z");

/** One record with a fresh timestamp; `origin` marks a subagent's. */
export function rec(
  type: AmspRecord["type"],
  payload: Record<string, unknown>,
  origin?: string[],
): AmspRecord {
  clock += 10;
  return {
    timestamp: new Date(clock).toISOString(),
    type,
    payload: payload as unknown as AmspRecord["payload"],
    ...(origin !== undefined ? { origin } : {}),
  } as AmspRecord;
}

export const ev = (payload: Record<string, unknown>, origin?: string[]) =>
  rec("event_msg", payload, origin);
export const model = (payload: Record<string, unknown>, origin?: string[]) =>
  rec("model_msg", payload, origin);

export const counts = (output: number, total: number, cacheRead = 0): TokenCounts => ({
  cache_read: cacheRead,
  cache_write: 0,
  output,
  total,
});

export const meta = (sessionId: string) =>
  rec("session_meta", {
    session_id: sessionId,
    provider: "loopback",
    model_id: "pinned-model",
    model_context_window: 200000,
    system_prompt: "You are a fixture.",
    agent_state: "/data/agents/demo/coder/agent_state",
    workspace: "/work",
    source: "api",
  });
export const taskBegin = () => ev({ type: "task_begin" });
export const taskEnd = () => ev({ type: "task_end" });
export const userText = (text: string) => model({ type: "text", role: "user", text });
export const requestBegin = (origin?: string[]) =>
  ev({ type: "request_begin", thinking_level: "medium" }, origin);
export const requestEnd = (
  status = "completed",
  extra: Record<string, unknown> = {},
  origin?: string[],
) => ev({ type: "request_end", status, ...extra }, origin);
export const usage = (request: TokenCounts, session: TokenCounts, origin?: string[]) =>
  ev({ type: "token_usage", request, session }, origin);
export const partialText = (eventType: "start" | "delta" | "stop", text = "", origin?: string[]) =>
  model({ type: "partial_text", role: "assistant", event_type: eventType, text }, origin);
export const assistantText = (text: string, origin?: string[]) =>
  model({ type: "text", role: "assistant", text }, origin);
export const toolCall = (id: string, args = '{"cmd":"ls"}', origin?: string[]) =>
  model({ type: "tool_call", name: "exec_command", arguments: args, tool_call_id: id }, origin);
/** A streamed fragment of a call. */
export const partialToolCall = (
  id: string,
  eventType: "start" | "delta" | "stop",
  args = "",
  origin?: string[],
) =>
  model(
    {
      type: "partial_tool_call",
      role: "assistant",
      event_type: eventType,
      name: eventType === "start" ? "exec_command" : "",
      arguments: args,
      tool_call_id: id,
    },
    origin,
  );
export const toolOutput = (id: string, output: string, origin?: string[]) =>
  model({ type: "tool_call_output", output, tool_call_id: id, status: "completed" }, origin);
export const decision = (id: string, decided: "allow" | "deny", origin?: string[]) =>
  ev({ type: "approval_decision", decision: decided, tool_call_id: id }, origin);
export const abort = (errorCode = "user_abort", extra: Record<string, unknown> = {}) =>
  ev({ type: "abort", error_code: errorCode, ...extra });
export const compactionBegin = () =>
  ev({ type: "compaction_begin", reason: "context", mode: "summarize", context: 900, turns: 2 });
export const compactionEnd = (status = "completed", extra: Record<string, unknown> = {}) =>
  ev({ type: "compaction_end", reason: "context", mode: "summarize", status, ...extra });

/** A plain first message: the meta, one Task, one Request answering in streamed text. */
export function plainRun(sessionId: string, answer = "Hello!"): AmspRecord[] {
  return [
    meta(sessionId),
    taskBegin(),
    userText("Say hello"),
    requestBegin(),
    partialText("start"),
    partialText("delta", answer),
    partialText("stop"),
    assistantText(answer),
    usage(counts(5, 45, 40), counts(5, 45, 40)),
    requestEnd(),
    taskEnd(),
  ];
}
