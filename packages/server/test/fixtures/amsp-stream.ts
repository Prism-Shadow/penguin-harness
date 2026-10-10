/**
 * Scripted AMSP runs, shared by the server's wire suite (amsp-routes.test.ts) and the client's
 * (packages/amsp/test, which imports this file read-only).
 *
 * Each script is one run: the internal stream a Session's runtime yields for it (OmniMessage
 * envelopes, as plain JSON — `{ approve }` steps mark where the runtime asks for an approval) and
 * the AMSP events the caller receives for it, `run.started` through `run.done`. The server suite
 * plays `steps` through a fake Session and checks the stream it reads back equals `events`; the
 * client suite serves `toSse(events)` as the response body.
 *
 * Every `at` the server stamps itself (`run.started`, `run.done`, `approval.requested`) reads
 * AMSP_FIXTURE_NOW here; the wire suite compares those after pinning them to it. Everything else
 * carries the timestamp of the message it was projected from.
 *
 * Self-contained on purpose — only type imports — so the client package can read it without
 * depending on the server or core.
 */
import type { AmspEvent } from "@prismshadow/amsp";

/** The `at` of every server-stamped event in `events`. */
export const AMSP_FIXTURE_NOW = "2026-10-07T10:00:00.000Z";

/** The Agent the scripts run on, as the wire names it (`<projectId>/<agentId>`). */
export const AMSP_FIXTURE_AGENT = "default_project/default_agent";

/** One step of a script's internal stream: a message the runtime yields, or an approval it asks for. */
export type AmspScriptStep =
  | { message: Record<string, unknown> }
  | { approve: { tool_call_id: string; name: string; arguments: string } };

export interface AmspStreamScript {
  /** What the scenario is, for test names. */
  name: string;
  /** The API Session the run continues. */
  sessionId: string;
  /** The approval mode the Session runs with (an asking one when a step asks). */
  approvalMode: "allow-all" | "always-ask";
  /** The request body's `input`. */
  input: string;
  /** What the Session's runtime does for the run, in order. */
  steps: AmspScriptStep[];
  /** What the caller receives, in order, before `data: [DONE]`. */
  events: AmspEvent[];
}

/** The response body a server writes for `events`: one `data:` block each, then `[DONE]`. */
export function toSse(events: readonly AmspEvent[]): string {
  return [...events.map((e) => `data: ${JSON.stringify(e)}\n\n`), "data: [DONE]\n\n"].join("");
}

const at = (ms: number): string => `2026-10-07T10:00:00.${String(ms).padStart(3, "0")}Z`;
const msg = (
  ms: number,
  type: "model_msg" | "event_msg" | "session_meta",
  payload: Record<string, unknown>,
  origin?: string[],
): AmspScriptStep => ({
  message: { timestamp: at(ms), type, payload, ...(origin !== undefined ? { origin } : {}) },
});
const usage = (output: number, total: number) => ({
  cache_read: 0,
  cache_write: 0,
  output,
  total,
});

/** A plain answer: one Request, streamed text, its usage. */
export const PLAIN_ANSWER: AmspStreamScript = {
  name: "a plain answer",
  sessionId: "session-2026-10-07-10-00-00-a0000001",
  approvalMode: "allow-all",
  input: "Say hello",
  steps: [
    msg(100, "event_msg", { type: "request_begin" }),
    msg(110, "model_msg", {
      type: "partial_text",
      role: "assistant",
      event_type: "start",
      text: "",
      stop_reason: "completed",
    }),
    msg(120, "model_msg", {
      type: "partial_text",
      role: "assistant",
      event_type: "delta",
      text: "Hello",
      stop_reason: "completed",
    }),
    msg(130, "model_msg", {
      type: "partial_text",
      role: "assistant",
      event_type: "delta",
      text: "!",
      stop_reason: "completed",
    }),
    msg(140, "model_msg", {
      type: "partial_text",
      role: "assistant",
      event_type: "stop",
      text: "",
      stop_reason: "completed",
    }),
    msg(150, "model_msg", {
      type: "text",
      role: "assistant",
      text: "Hello!",
      stop_reason: "completed",
    }),
    msg(160, "event_msg", { type: "token_usage", session: usage(2, 412), request: usage(2, 412) }),
    msg(170, "event_msg", { type: "request_end", status: "completed" }),
  ],
  events: [
    {
      type: "run.started",
      at: AMSP_FIXTURE_NOW,
      session_id: "session-2026-10-07-10-00-00-a0000001",
      agent: AMSP_FIXTURE_AGENT,
    },
    { type: "request.started", at: at(100), request: 1 },
    { type: "text.delta", at: at(110), role: "assistant", text: "" },
    { type: "text.delta", at: at(120), role: "assistant", text: "Hello" },
    { type: "text.delta", at: at(130), role: "assistant", text: "!" },
    { type: "text.done", at: at(150), role: "assistant", text: "Hello!", stop_reason: "completed" },
    {
      type: "request.done",
      at: at(170),
      request: 1,
      status: "completed",
      usage: usage(2, 412),
    },
    {
      type: "run.done",
      at: AMSP_FIXTURE_NOW,
      status: "completed",
      requests: 1,
      usage: usage(2, 412),
      session_usage: usage(2, 412),
    },
  ],
};

const LS_ARGS = '{"command":"ls"}';

/**
 * A tool call the caller approves, then a second Request. The tool runs while its Request is
 * still open: the approval and the start of the result arrive before `request.done`, the rest
 * after it — as the engine streams them.
 */
export const APPROVAL_ROUND_TRIP: AmspStreamScript = {
  name: "a tool call the caller approves",
  sessionId: "session-2026-10-07-10-00-00-a0000002",
  approvalMode: "always-ask",
  input: "List the files",
  steps: [
    msg(100, "event_msg", { type: "request_begin" }),
    msg(110, "model_msg", {
      type: "partial_tool_call",
      role: "assistant",
      event_type: "start",
      name: "exec_command",
      arguments: "",
      tool_call_id: "call_1",
      stop_reason: "completed",
    }),
    msg(120, "model_msg", {
      type: "partial_tool_call",
      role: "assistant",
      event_type: "delta",
      name: "",
      arguments: LS_ARGS,
      tool_call_id: "call_1",
      stop_reason: "completed",
    }),
    msg(130, "model_msg", {
      type: "partial_tool_call",
      role: "assistant",
      event_type: "stop",
      name: "",
      arguments: "",
      tool_call_id: "call_1",
      stop_reason: "completed",
    }),
    msg(140, "model_msg", {
      type: "tool_call",
      role: "assistant",
      name: "exec_command",
      arguments: LS_ARGS,
      tool_call_id: "call_1",
      stop_reason: "completed",
    }),
    { approve: { tool_call_id: "call_1", name: "exec_command", arguments: LS_ARGS } },
    msg(150, "event_msg", { type: "approval_decision", decision: "allow", tool_call_id: "call_1" }),
    msg(160, "model_msg", {
      type: "partial_tool_call_output",
      role: "user",
      event_type: "start",
      output: "",
      tool_call_id: "call_1",
      stop_reason: "completed",
    }),
    msg(170, "event_msg", {
      type: "token_usage",
      session: usage(12, 500),
      request: usage(12, 500),
    }),
    msg(180, "event_msg", { type: "request_end", status: "completed" }),
    msg(190, "model_msg", {
      type: "partial_tool_call_output",
      role: "user",
      event_type: "delta",
      output: "README.md\nsrc\n",
      tool_call_id: "call_1",
      stop_reason: "completed",
    }),
    msg(200, "model_msg", {
      type: "partial_tool_call_output",
      role: "user",
      event_type: "stop",
      output: "",
      tool_call_id: "call_1",
      stop_reason: "completed",
    }),
    msg(210, "model_msg", {
      type: "tool_call_output",
      role: "user",
      output: "README.md\nsrc\n",
      tool_call_id: "call_1",
      stop_reason: "completed",
    }),
    msg(220, "event_msg", { type: "request_begin" }),
    msg(230, "model_msg", {
      type: "text",
      role: "assistant",
      text: "Two entries: README.md and src.",
      stop_reason: "completed",
    }),
    msg(240, "event_msg", {
      type: "token_usage",
      session: usage(22, 1100),
      request: usage(10, 600),
    }),
    msg(250, "event_msg", { type: "request_end", status: "completed" }),
  ],
  events: [
    {
      type: "run.started",
      at: AMSP_FIXTURE_NOW,
      session_id: "session-2026-10-07-10-00-00-a0000002",
      agent: AMSP_FIXTURE_AGENT,
    },
    { type: "request.started", at: at(100), request: 1 },
    {
      type: "tool_call.delta",
      at: at(110),
      tool_call_id: "call_1",
      name: "exec_command",
      arguments: "",
    },
    { type: "tool_call.delta", at: at(120), tool_call_id: "call_1", name: "", arguments: LS_ARGS },
    {
      type: "tool_call.done",
      at: at(140),
      tool_call_id: "call_1",
      name: "exec_command",
      arguments: LS_ARGS,
      stop_reason: "completed",
    },
    {
      type: "approval.requested",
      at: AMSP_FIXTURE_NOW,
      tool_call: { tool_call_id: "call_1", name: "exec_command", arguments: LS_ARGS },
    },
    { type: "approval.decided", at: at(150), tool_call_id: "call_1", decision: "allow" },
    { type: "tool_result.delta", at: at(160), tool_call_id: "call_1", output: "" },
    {
      type: "request.done",
      at: at(180),
      request: 1,
      status: "completed",
      usage: usage(12, 500),
    },
    {
      type: "tool_result.delta",
      at: at(190),
      tool_call_id: "call_1",
      output: "README.md\nsrc\n",
    },
    {
      type: "tool_result.done",
      at: at(210),
      tool_call_id: "call_1",
      output: "README.md\nsrc\n",
      stop_reason: "completed",
    },
    { type: "request.started", at: at(220), request: 2 },
    {
      type: "text.done",
      at: at(230),
      role: "assistant",
      text: "Two entries: README.md and src.",
      stop_reason: "completed",
    },
    {
      type: "request.done",
      at: at(250),
      request: 2,
      status: "completed",
      usage: usage(10, 600),
    },
    {
      type: "run.done",
      at: AMSP_FIXTURE_NOW,
      status: "completed",
      requests: 2,
      usage: usage(22, 1100),
      session_usage: usage(22, 1100),
    },
  ],
};

const CHILD = "session-2026-10-07-10-00-01-c0000001";

/**
 * A run with everything a caller collecting "the answer" must leave out: a steering message,
 * a subagent child's own context and reply (origin-tagged), and a compaction whose summary
 * streams as `summary.delta` (the engine streams a summary's fragments or its complete text,
 * never both). The answer is the main Session's two assistant texts.
 */
export const MIXED_RUN: AmspStreamScript = {
  name: "a run with steering, a subagent and a compaction",
  sessionId: "session-2026-10-07-10-00-00-a0000003",
  approvalMode: "allow-all",
  input: "Fix the build",
  steps: [
    msg(100, "event_msg", { type: "request_begin" }),
    msg(110, "model_msg", {
      type: "text",
      role: "assistant",
      text: "Working on it.",
      stop_reason: "completed",
    }),
    msg(120, "event_msg", { type: "token_usage", session: usage(4, 300), request: usage(4, 300) }),
    msg(130, "event_msg", { type: "request_end", status: "completed" }),
    msg(140, "model_msg", {
      type: "text",
      role: "user",
      text: "[user_steering]\nalso run the tests\n[/user_steering]",
      stop_reason: "completed",
    }),
    msg(
      150,
      "session_meta",
      {
        session_id: CHILD,
        provider: "custom",
        model_id: "m1",
        model_context_window: 128000,
        system_prompt: "",
        agent_state: "/data/default_project/agents/default_agent/agent_state",
        workspace: "/tmp/w",
        source: "subagent",
      },
      [CHILD],
    ),
    msg(160, "event_msg", { type: "request_begin" }, [CHILD]),
    msg(
      170,
      "model_msg",
      { type: "text", role: "assistant", text: "Tests pass.", stop_reason: "completed" },
      [CHILD],
    ),
    msg(180, "event_msg", { type: "token_usage", session: usage(3, 200), request: usage(3, 200) }, [
      CHILD,
    ]),
    msg(190, "event_msg", { type: "request_end", status: "completed" }, [CHILD]),
    msg(200, "event_msg", {
      type: "compaction_begin",
      reason: "context",
      mode: "summarize",
      context: 300,
      turns: 1,
    }),
    msg(210, "model_msg", {
      type: "partial_text",
      role: "assistant",
      event_type: "start",
      text: "",
      stop_reason: "completed",
    }),
    msg(220, "model_msg", {
      type: "partial_text",
      role: "assistant",
      event_type: "delta",
      text: "Summary.",
      stop_reason: "completed",
    }),
    msg(230, "model_msg", {
      type: "partial_text",
      role: "assistant",
      event_type: "stop",
      text: "",
      stop_reason: "completed",
    }),
    msg(240, "event_msg", { type: "token_usage", session: usage(9, 700), request: usage(5, 400) }),
    msg(250, "event_msg", {
      type: "compaction_end",
      reason: "context",
      mode: "summarize",
      status: "completed",
      attempt: 1,
    }),
    msg(260, "event_msg", { type: "request_begin" }),
    msg(270, "model_msg", {
      type: "text",
      role: "assistant",
      text: "Done: the build is green.",
      stop_reason: "completed",
    }),
    msg(280, "event_msg", { type: "token_usage", session: usage(15, 900), request: usage(6, 200) }),
    msg(290, "event_msg", { type: "request_end", status: "completed" }),
  ],
  events: [
    {
      type: "run.started",
      at: AMSP_FIXTURE_NOW,
      session_id: "session-2026-10-07-10-00-00-a0000003",
      agent: AMSP_FIXTURE_AGENT,
    },
    { type: "request.started", at: at(100), request: 1 },
    {
      type: "text.done",
      at: at(110),
      role: "assistant",
      text: "Working on it.",
      stop_reason: "completed",
    },
    { type: "request.done", at: at(130), request: 1, status: "completed", usage: usage(4, 300) },
    {
      type: "text.done",
      at: at(140),
      role: "user",
      text: "[user_steering]\nalso run the tests\n[/user_steering]",
      stop_reason: "completed",
    },
    {
      type: "context.opened",
      at: at(150),
      origin: [CHILD],
      session_id: CHILD,
      provider: "custom",
      model_id: "m1",
      context_window: 128000,
    },
    { type: "request.started", at: at(160), origin: [CHILD], request: 1 },
    {
      type: "text.done",
      at: at(170),
      origin: [CHILD],
      role: "assistant",
      text: "Tests pass.",
      stop_reason: "completed",
    },
    {
      type: "request.done",
      at: at(190),
      origin: [CHILD],
      request: 1,
      status: "completed",
      usage: usage(3, 200),
    },
    {
      type: "compaction.started",
      at: at(200),
      reason: "context",
      mode: "summarize",
      context: 300,
      turns: 1,
    },
    { type: "summary.delta", at: at(210), text: "" },
    { type: "summary.delta", at: at(220), text: "Summary." },
    {
      type: "compaction.done",
      at: at(250),
      reason: "context",
      mode: "summarize",
      status: "completed",
      usage: usage(5, 400),
      attempt: 1,
    },
    { type: "request.started", at: at(260), request: 2 },
    {
      type: "text.done",
      at: at(270),
      role: "assistant",
      text: "Done: the build is green.",
      stop_reason: "completed",
    },
    { type: "request.done", at: at(290), request: 2, status: "completed", usage: usage(6, 200) },
    {
      type: "run.done",
      at: AMSP_FIXTURE_NOW,
      status: "completed",
      requests: 3,
      usage: usage(18, 1100),
      session_usage: usage(15, 900),
    },
  ],
};

/** Every script, for suites that play them all. */
export const AMSP_STREAM_SCRIPTS: readonly AmspStreamScript[] = [
  PLAIN_ANSWER,
  APPROVAL_ROUND_TRIP,
  MIXED_RUN,
];
