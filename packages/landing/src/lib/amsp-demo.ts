/**
 * The runs the /amsp page replays: three AMSP v2 run streams, scripted by hand (no model was
 * called). The records, their order and their fields follow the protocol as the engine emits
 * them: a Request pair brackets the model's output, a tool runs while its Request is still open
 * and its result completes after `request_end`, fragments stream `start → delta → stop` and the
 * complete message follows. The model is a script (`mock/scripted-model`), so its words, the
 * timings and the token counts are illustrative. `tool_list_ready` carries tool names only.
 *
 * Each run is what `POST /api/amsp/v2/agents/demo/coder/runs` answers, from the `hello` that
 * names the Session to the `task_state` that ends the stream (the `[DONE]` line after it is the
 * transport's, not an event). Typed on amsp-protocol.ts, so a kind the vocabulary does not list
 * fails to typecheck. test/amsp-demo.test.ts holds the runs to the protocol's ordering rules.
 */
import type {
  AmspEvent,
  EventPayload,
  ModelPayload,
  ServerEventPayload,
  SessionMetaPayload,
  TokenCounts,
  ToolCallRecord,
} from "./amsp-protocol";
import { AMSP_DEMO_AGENT } from "./amsp-quickstart";

export type ScenarioId = "tool" | "approval" | "answer";

export interface AmspScenario {
  id: ScenarioId;
  input: string;
  /** The caller's answer to the run's `approval_request`. */
  decision?: "allow";
  /** The run continues a Session an earlier run opened: its context is open, no `session_meta`. */
  continues?: boolean;
  events: readonly AmspEvent[];
}

/** An event before the clock stamps it (the omit distributes, keeping each envelope's payload). */
type Unstamped<E> = E extends AmspEvent ? Omit<E, "timestamp"> : never;
type Untimed = Unstamped<AmspEvent>;

/**
 * One step of a run: the milliseconds since the previous event, and the event — or, for an event
 * that quotes an earlier one, a function of the events stamped so far.
 */
type Step = readonly [gapMs: number, event: Untimed | ((before: readonly AmspEvent[]) => Untimed)];

const server = (payload: ServerEventPayload): Untimed => ({ type: "server_event", payload });
const model = (payload: ModelPayload): Untimed => ({ type: "model_msg", payload });
const record = (payload: EventPayload): Untimed => ({ type: "event_msg", payload });
const meta = (payload: SessionMetaPayload): Untimed => ({ type: "session_meta", payload });

/** Stamps each step at its gap after the previous one, starting from `start`. */
function timed(start: string, steps: readonly Step[]): AmspEvent[] {
  let clock = Date.parse(start);
  const events: AmspEvent[] = [];
  for (const [gap, step] of steps) {
    clock += gap;
    const event = typeof step === "function" ? step(events) : step;
    events.push({ ...event, timestamp: new Date(clock).toISOString() } as AmspEvent);
  }
  return events;
}

/** The newest complete tool call among `events`. */
function lastToolCall(events: readonly AmspEvent[]): ToolCallRecord {
  const call = events.findLast(
    (event): event is ToolCallRecord =>
      event.type === "model_msg" && event.payload.type === "tool_call",
  );
  if (call === undefined) throw new Error("approval_request before any tool_call");
  return call;
}

const counts = (cache_read: number, cache_write: number, output: number, total: number) => ({
  cache_read,
  cache_write,
  output,
  total,
});

const add = (a: TokenCounts, b: TokenCounts): TokenCounts =>
  counts(
    a.cache_read + b.cache_read,
    a.cache_write + b.cache_write,
    a.output + b.output,
    a.total + b.total,
  );

/** The Session the tool-call run opens and the plain answer continues. */
const SESSION = "session-2026-10-21-09-41-07-5d0c2e7a";
const APPROVAL_SESSION = "session-2026-10-21-09-42-30-81b4e0c9";

const CALL_ID = "call_7f3a2c";
const DATE_ARGUMENTS = '{"cmd":"date"}';
const TOOLS = [
  "exec_command",
  "input_command",
  "read_file",
  "write_file",
  "edit_file",
  "run_subagent",
  "input_subagent",
];

/** Per-Request usage of the two date runs, and of the plain answer that continues the first. */
const REQUEST_1 = counts(0, 2816, 58, 3004);
const REQUEST_2 = counts(2816, 162, 31, 3021);
const REQUEST_3 = counts(2978, 52, 18, 3057);

/** The opening of a new Session's run: who it is, the context it opened, its tools. */
function opening(sessionId: string): Step[] {
  return [
    [0, server({ type: "hello", session_id: sessionId, agent: AMSP_DEMO_AGENT })],
    [
      12,
      meta({
        session_id: sessionId,
        provider: "mock",
        model_id: "scripted-model",
        model_context_window: 200000,
        system_prompt:
          "You are coder. Work in the Workspace, run commands with exec_command, and answer briefly.",
        agent_state: "/home/me/.penguin/data/projects/demo/agents/coder",
        workspace: "/home/me/work",
        source: "api",
      }),
    ],
    [6, record({ type: "tool_list_ready", tools: TOOLS.map((name) => ({ name })) })],
  ];
}

const thinkingSteps = (pieces: readonly string[]): Step[] => [
  [690, model({ type: "partial_thinking", role: "assistant", event_type: "start", thinking: "" })],
  ...pieces.map((thinking, i): Step => [
    i === 0 ? 40 : 70,
    model({ type: "partial_thinking", role: "assistant", event_type: "delta", thinking }),
  ]),
  [6, model({ type: "partial_thinking", role: "assistant", event_type: "stop", thinking: "" })],
  [
    2,
    model({
      type: "thinking",
      role: "assistant",
      thinking: pieces.join(""),
      stop_reason: "completed",
    }),
  ],
];

const textSteps = (firstGap: number, pieces: readonly string[]): Step[] => [
  [firstGap, model({ type: "partial_text", role: "assistant", event_type: "start", text: "" })],
  ...pieces.map((text, i): Step => [
    i === 0 ? 40 : 48,
    model({ type: "partial_text", role: "assistant", event_type: "delta", text }),
  ]),
  [5, model({ type: "partial_text", role: "assistant", event_type: "stop", text: "" })],
  [2, model({ type: "text", role: "assistant", text: pieces.join(""), stop_reason: "completed" })],
];

const callSteps = (): Step[] => [
  [
    62,
    model({
      type: "partial_tool_call",
      role: "assistant",
      event_type: "start",
      name: "exec_command",
      arguments: "",
      tool_call_id: CALL_ID,
    }),
  ],
  ...['{"cmd":', '"date"}'].map((args, i): Step => [
    i === 0 ? 40 : 35,
    model({
      type: "partial_tool_call",
      role: "assistant",
      event_type: "delta",
      name: "",
      arguments: args,
      tool_call_id: CALL_ID,
    }),
  ]),
  [
    5,
    model({
      type: "partial_tool_call",
      role: "assistant",
      event_type: "stop",
      name: "",
      arguments: "",
      tool_call_id: CALL_ID,
    }),
  ],
  [
    2,
    model({
      type: "tool_call",
      role: "assistant",
      name: "exec_command",
      arguments: DATE_ARGUMENTS,
      tool_call_id: CALL_ID,
      stop_reason: "completed",
    }),
  ],
];

const outputSteps = (clock: string): { head: Step[]; tail: Step[] } => ({
  head: [
    [
      8,
      model({
        type: "partial_tool_call_output",
        role: "user",
        event_type: "start",
        output: "",
        tool_call_id: CALL_ID,
      }),
    ],
  ],
  tail: [
    [
      35,
      model({
        type: "partial_tool_call_output",
        role: "user",
        event_type: "delta",
        output: clock,
        tool_call_id: CALL_ID,
      }),
    ],
    [
      3,
      model({
        type: "partial_tool_call_output",
        role: "user",
        event_type: "stop",
        output: "",
        tool_call_id: CALL_ID,
      }),
    ],
    [
      2,
      model({
        type: "tool_call_output",
        role: "user",
        output: clock,
        tool_call_id: CALL_ID,
        stop_reason: "completed",
      }),
    ],
  ],
});

/**
 * "What time is it now?" on a new Session: the model thinks, calls `date`, reads the clock in a
 * second Request and answers. With `approvalWaitMs`, the Session asks before every tool call
 * (always-ask) and the caller allows this one after that long.
 */
function dateRun(start: string, sessionId: string, clock: string, approvalWaitMs?: number) {
  const output = outputSteps(clock);
  const hhmm = clock.slice(11, 16);
  const steps: Step[] = [
    ...opening(sessionId),
    [2, record({ type: "task_begin" })],
    [2, model({ type: "text", role: "user", text: "What time is it now?" })],
    [8, record({ type: "request_begin", thinking_level: "medium" })],
    ...thinkingSteps([
      "The user wants the current time.",
      " I'll read the server's clock with date.",
    ]),
    ...callSteps(),
    ...(approvalWaitMs === undefined
      ? []
      : ([
          [8, (before) => server({ type: "approval_request", toolCall: lastToolCall(before) })],
          [
            approvalWaitMs,
            record({ type: "approval_decision", decision: "allow", tool_call_id: CALL_ID }),
          ],
        ] satisfies Step[])),
    ...output.head,
    [4, record({ type: "token_usage", session: REQUEST_1, request: REQUEST_1 })],
    [2, record({ type: "request_end", status: "completed" })],
    ...output.tail,
    [8, record({ type: "request_begin", thinking_level: "medium" })],
    ...textSteps(566, [
      `It's ${hhmm} UTC`,
      " on Wednesday, October 21, 2026,",
      " by the server's clock.",
    ]),
    [8, record({ type: "token_usage", session: add(REQUEST_1, REQUEST_2), request: REQUEST_2 })],
    [2, record({ type: "request_end", status: "completed" })],
    [8, record({ type: "task_end", status: "completed" })],
    [2, server({ type: "task_state", state: "idle" })],
  ];
  return timed(start, steps);
}

/** The plain answer continues the tool-call run's Session: one Request, text only. */
const ANSWER: AmspEvent[] = timed("2026-10-21T09:41:15.000Z", [
  [0, server({ type: "hello", session_id: SESSION, agent: AMSP_DEMO_AGENT })],
  [6, record({ type: "task_begin" })],
  [2, model({ type: "text", role: "user", text: "Now say it in French." })],
  [8, record({ type: "request_begin", thinking_level: "medium" })],
  ...textSteps(574, ["Il est 9 h 41 UTC,", " le mercredi 21 octobre 2026."]),
  [
    8,
    record({
      type: "token_usage",
      session: add(add(REQUEST_1, REQUEST_2), REQUEST_3),
      request: REQUEST_3,
    }),
  ],
  [2, record({ type: "request_end", status: "completed" })],
  [8, record({ type: "task_end", status: "completed" })],
  [2, server({ type: "task_state", state: "idle" })],
]);

export const SCENARIOS: readonly AmspScenario[] = [
  {
    id: "tool",
    input: "What time is it now?",
    events: dateRun("2026-10-21T09:41:07.000Z", SESSION, "Wed Oct 21 09:41:08 UTC 2026\n"),
  },
  {
    id: "approval",
    input: "What time is it now?",
    decision: "allow",
    events: dateRun(
      "2026-10-21T09:42:30.000Z",
      APPROVAL_SESSION,
      "Wed Oct 21 09:42:32 UTC 2026\n",
      1250,
    ),
  },
  { id: "answer", input: "Now say it in French.", continues: true, events: ANSWER },
];
