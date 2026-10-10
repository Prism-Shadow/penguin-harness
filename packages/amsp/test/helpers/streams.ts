/**
 * Two runs as the server's wire suite captured them (packages/server/test/fixtures/amsp-stream.ts,
 * `events`), copied here event for event rather than imported: this package depends on nothing,
 * its tests included. They are the orders the engine really produces, and the ones the first
 * draft of the protocol got wrong:
 * - a tool call the caller approves: the approval and the first fragment of the result arrive
 *   while the Request is still open, the rest of the result after its request.done, and a second
 *   Request answers;
 * - a run with steering, a subagent and a compaction: a user text mid-run, a child Session's
 *   context and reply (origin-tagged), and a compaction whose summary streams as fragments with
 *   no summary.done.
 * A plain answer (one Request, streamed text) has the same order in the fixture as the suite's
 * own PLAIN.
 */
import type { AmspEvent } from "../../src/index.js";

/** The `at` of every server-stamped event (run.started, run.done, approval.requested). */
export const FIXTURE_NOW = "2026-10-07T10:00:00.000Z";

const AGENT = "default_project/default_agent";
const at = (ms: number): string => `2026-10-07T10:00:00.${String(ms).padStart(3, "0")}Z`;
const usage = (output: number, total: number) => ({ cache_read: 0, cache_write: 0, output, total });

/** The Session a captured run named in its run.started. */
export function sessionOf(events: readonly AmspEvent[]): string {
  const first = events[0];
  if (first?.type !== "run.started") throw new Error("a captured run starts with run.started");
  return first.session_id;
}

const LS_ARGS = '{"command":"ls"}';

export const APPROVAL_ROUND_TRIP: readonly AmspEvent[] = [
  {
    type: "run.started",
    at: FIXTURE_NOW,
    session_id: "session-2026-10-07-10-00-00-a0000002",
    agent: AGENT,
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
    at: FIXTURE_NOW,
    tool_call: { tool_call_id: "call_1", name: "exec_command", arguments: LS_ARGS },
  },
  { type: "approval.decided", at: at(150), tool_call_id: "call_1", decision: "allow" },
  { type: "tool_result.delta", at: at(160), tool_call_id: "call_1", output: "" },
  { type: "request.done", at: at(180), request: 1, status: "completed", usage: usage(12, 500) },
  { type: "tool_result.delta", at: at(190), tool_call_id: "call_1", output: "README.md\nsrc\n" },
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
  { type: "request.done", at: at(250), request: 2, status: "completed", usage: usage(10, 600) },
  {
    type: "run.done",
    at: FIXTURE_NOW,
    status: "completed",
    requests: 2,
    usage: usage(22, 1100),
    session_usage: usage(22, 1100),
  },
];

const CHILD = "session-2026-10-07-10-00-01-c0000001";

export const MIXED_RUN: readonly AmspEvent[] = [
  {
    type: "run.started",
    at: FIXTURE_NOW,
    session_id: "session-2026-10-07-10-00-00-a0000003",
    agent: AGENT,
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
    at: FIXTURE_NOW,
    status: "completed",
    requests: 3,
    usage: usage(18, 1100),
    session_usage: usage(15, 900),
  },
];
