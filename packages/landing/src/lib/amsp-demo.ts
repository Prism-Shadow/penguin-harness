/**
 * The runs the /amsp page replays: three AMSP run streams on one Session, scripted by hand (no
 * model was called). The records, their order and their fields follow PRFC-0021 and the engine as
 * it emits them:
 *
 * - every stream opens with the `ping` control frame; on the Session's first message the first
 *   record is `session_meta`, whose `session_id` names the new Session, then `task_begin`, then the
 *   echoed input; a later message, on the `session_id` its request sent, starts at `task_begin`;
 * - a Request pair brackets the model's output; a tool runs while its Request is still open and its
 *   output completes after `request_end`;
 * - fragments stream `start → delta → stop`, then the complete message follows;
 * - `task_end` closes the Task and `data: [DONE]` the stream.
 *
 * The interrupted run aborts mid-reply, through the abort request beside the stream: the reply
 * closes with what had arrived (`stop_reason: aborted`, no `token_usage`), `request_end` reads
 * `aborted`, the `abort` record follows, and the Task still closes with `task_end` before
 * `[DONE]`. The model is a script (`mock/scripted-model`), so its words, the timings and the token
 * counts are illustrative.
 *
 * Typed on amsp-protocol.ts, so a kind the vocabulary does not list fails to typecheck.
 * test/amsp-demo.test.ts holds the runs to the protocol's ordering rules.
 */
import type {
  AmspControl,
  AmspRecord,
  EventPayload,
  ModelPayload,
  SessionMetaPayload,
  TokenCounts,
} from "./amsp-protocol";

/** A request the caller sends beside the stream (the interrupted run's abort). */
export interface CallerRequest {
  method: "POST";
  /** Under the key door, `/api/amsp/v1`. */
  path: string;
}

/** One step of a run as the client sees it. */
export type RunStep =
  | { kind: "control"; control: AmspControl }
  | { kind: "record"; id: string; record: AmspRecord }
  | { kind: "request"; at: string; request: CallerRequest }
  | { kind: "done" };

export type ScenarioId = "first" | "continue" | "interrupt";

export interface AmspScenario {
  id: ScenarioId;
  input: string;
  /** The run continues the Session an earlier run opened: no `session_meta` on its stream. */
  continues?: boolean;
  /** The caller aborts the run this long after starting it. */
  abortAfterMs?: number;
  steps: readonly RunStep[];
}

/** A record before the clock stamps it (the omit distributes, keeping each envelope's payload). */
type Unstamped<R> = R extends AmspRecord ? Omit<R, "timestamp"> : never;
type Draft =
  | { control: AmspControl }
  | { record: Unstamped<AmspRecord> }
  | { request: CallerRequest }
  | { done: true };

/** One step to script: the milliseconds since the previous one, and what it is. */
type Script = readonly [gapMs: number, draft: Draft];

const model = (payload: ModelPayload): Draft => ({ record: { type: "model_msg", payload } });
const record = (payload: EventPayload): Draft => ({ record: { type: "event_msg", payload } });
const meta = (payload: SessionMetaPayload): Draft => ({
  record: { type: "session_meta", payload },
});

/**
 * Stamps each step at its gap after the previous one, starting from `start`, and numbers the
 * records the way the server's channel does (`<epoch>-<seq>`), from `firstSeq`.
 */
function timed(start: string, epoch: string, script: readonly Script[], firstSeq = 1): RunStep[] {
  let clock = Date.parse(start);
  let seq = firstSeq - 1;
  return script.map(([gap, draft]): RunStep => {
    clock += gap;
    const at = new Date(clock).toISOString();
    if ("control" in draft) return { kind: "control", control: draft.control };
    if ("request" in draft) return { kind: "request", at, request: draft.request };
    if ("done" in draft) return { kind: "done" };
    seq += 1;
    return {
      kind: "record",
      id: `${epoch}-${seq}`,
      record: { ...draft.record, timestamp: at } as AmspRecord,
    };
  });
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

/** The Session all three runs share: the first opens it, the other two continue it. */
const SESSION = "session-2026-10-21-09-41-07-5d0c2e7a";
const EPOCH = "5d0c";

const CALL_ID = "call_7f3a2c";
const DATE_ARGUMENTS = '{"cmd":"date"}';

/** Per-Request usage of the first run, and of the reply that continues it. */
const REQUEST_1 = counts(0, 2816, 58, 3004);
const REQUEST_2 = counts(2816, 162, 31, 3021);
const REQUEST_3 = counts(2978, 52, 18, 3057);

/** A run stream's first line: the heartbeat, sent at once. */
const ping: Script = [0, { control: { kind: "ping" } }];

/** On a Session's first message: the context it opened. */
const sessionMeta = (sessionId: string): Script => [
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
];

/** `task_begin`, then the input the server echoes. */
const taskOpening = (input: string): Script[] => [
  [4, record({ type: "task_begin" })],
  [2, model({ type: "text", role: "user", text: input, stop_reason: "completed" })],
];

const thinkingSteps = (pieces: readonly string[]): Script[] => [
  [690, model({ type: "partial_thinking", role: "assistant", event_type: "start", thinking: "" })],
  ...pieces.map((thinking, i): Script => [
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

/** A reply's fragments as they stream: its `start`, then one `delta` per piece. */
const replyPieces = (firstGap: number, pieces: readonly string[]): Script[] => [
  [firstGap, model({ type: "partial_text", role: "assistant", event_type: "start", text: "" })],
  ...pieces.map((text, i): Script => [
    i === 0 ? 40 : 48,
    model({ type: "partial_text", role: "assistant", event_type: "delta", text }),
  ]),
];

/** A reply's close: its `stop`, then the complete text; an interrupted one keeps what had arrived. */
const replyClose = (pieces: readonly string[], ended: "completed" | "aborted"): Script[] => [
  [
    5,
    model({
      type: "partial_text",
      role: "assistant",
      event_type: "stop",
      text: "",
      ...(ended === "aborted" ? { stop_reason: "aborted" as const } : {}),
    }),
  ],
  [2, model({ type: "text", role: "assistant", text: pieces.join(""), stop_reason: ended })],
];

const textSteps = (firstGap: number, pieces: readonly string[]): Script[] => [
  ...replyPieces(firstGap, pieces),
  ...replyClose(pieces, "completed"),
];

const callSteps = (): Script[] => [
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
  ...['{"cmd":', '"date"}'].map((args, i): Script => [
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

const outputStart: Script = [
  8,
  model({
    type: "partial_tool_call_output",
    role: "user",
    event_type: "start",
    output: "",
    tool_call_id: CALL_ID,
  }),
];

const outputRest = (clock: string): Script[] => [
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
];

/**
 * "What time is it now?" as the Session's first message: the model thinks, calls `date`, reads the
 * clock in a second Request and answers.
 */
const FIRST_RUN = timed("2026-10-21T09:41:07.000Z", EPOCH, [
  ping,
  sessionMeta(SESSION),
  ...taskOpening("What time is it now?"),
  [8, record({ type: "request_begin", thinking_level: "medium" })],
  ...thinkingSteps([
    "The user wants the current time.",
    " I'll read the server's clock with date.",
  ]),
  ...callSteps(),
  outputStart,
  [4, record({ type: "token_usage", session: REQUEST_1, request: REQUEST_1 })],
  [2, record({ type: "request_end", status: "completed" })],
  ...outputRest("Wed Oct 21 09:41:08 UTC 2026\n"),
  [8, record({ type: "request_begin", thinking_level: "medium" })],
  ...textSteps(566, [
    "It's 09:41 UTC",
    " on Wednesday, October 21, 2026,",
    " by the server's clock.",
  ]),
  [8, record({ type: "token_usage", session: add(REQUEST_1, REQUEST_2), request: REQUEST_2 })],
  [2, record({ type: "request_end", status: "completed" })],
  [8, record({ type: "task_end" })],
  [2, { done: true }],
]);

const recordCount = (steps: readonly RunStep[]) =>
  steps.filter((step) => step.kind === "record").length;

/** A follow-up on the same Session: no `session_meta`, one Request, the numbering carried on. */
const CONTINUE_RUN = timed(
  "2026-10-21T09:41:15.000Z",
  EPOCH,
  [
    ping,
    ...taskOpening("Now say it in French."),
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
    [8, record({ type: "task_end" })],
    [2, { done: true }],
  ],
  recordCount(FIRST_RUN) + 1,
);

/** How long after starting it the caller aborts the interrupted run. */
const ABORT_AFTER_MS = 750;

const HISTORY = ["The first mechanical clocks", " appeared in European", " monasteries around"];

/**
 * A long answer the caller stops mid-reply: the abort request lands, the reply closes with what had
 * arrived, the Request and then the run are marked aborted, and the Task still closes before
 * `[DONE]`.
 */
const INTERRUPT_RUN = timed(
  "2026-10-21T09:41:30.000Z",
  EPOCH,
  [
    ping,
    ...taskOpening("Explain clocks in depth."),
    [8, record({ type: "request_begin", thinking_level: "medium" })],
    ...replyPieces(600, HISTORY),
    [12, { request: { method: "POST", path: `/sessions/${SESSION}/abort` } }],
    ...replyClose(HISTORY, "aborted"),
    [6, record({ type: "request_end", status: "aborted" })],
    [2, record({ type: "abort", error_code: "user_abort" })],
    [4, record({ type: "task_end" })],
    [2, { done: true }],
  ],
  recordCount(FIRST_RUN) + recordCount(CONTINUE_RUN) + 1,
);

export const SCENARIOS: readonly AmspScenario[] = [
  { id: "first", input: "What time is it now?", steps: FIRST_RUN },
  { id: "continue", input: "Now say it in French.", continues: true, steps: CONTINUE_RUN },
  {
    id: "interrupt",
    input: "Explain clocks in depth.",
    continues: true,
    abortAfterMs: ABORT_AFTER_MS,
    steps: INTERRUPT_RUN,
  },
];

/** The records of a run, in order. */
export const recordsOf = (steps: readonly RunStep[]): AmspRecord[] =>
  steps.flatMap((step) => (step.kind === "record" ? [step.record] : []));
