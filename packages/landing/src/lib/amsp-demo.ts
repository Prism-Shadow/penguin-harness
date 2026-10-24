/**
 * The runs the /amsp page replays and charts: three AMSP run streams on one Session, scripted by
 * hand (no model was called). The records, their order and their fields follow the protocol as it
 * ships and the engine as it emits them:
 *
 * - every stream opens with the `ping` control frame; on the Session's first message the first
 *   record is `session_meta`, whose `session_id` names the new Session, then `task_begin`, then the
 *   echoed input; a later message, on the `session_id` its request sent, starts at `task_begin`;
 * - a Request pair brackets the model's output; a tool runs while its Request is still open and its
 *   output completes after `request_end`;
 * - a message streams `start → delta → stop`, then its complete record follows; one that is cut
 *   short streams its fragments and gets no complete record;
 * - `task_end` closes the Task and `data: [DONE]` the stream.
 *
 * The interrupted run aborts mid-reply, through the abort request beside the stream: the reply's
 * fragments close with their `stop` and no complete text follows, `request_end` reads `aborted`
 * (no `token_usage`), the `abort` record follows, and the Task still closes with `task_end` before
 * `[DONE]`.
 *
 * The timings are those of a real agent run: the first token a second or more after the request,
 * a few seconds of thinking, a `date` call that runs for a fifth of a second, a second Request of
 * a few seconds. Each message is shown as one `delta` (a real stream sends many), so a whole run
 * fits the player at once. The model is a script (`mock/scripted-model`), so its words and token
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
  StreamPhase,
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
const REQUEST_1 = counts(0, 2816, 146, 3092);
const REQUEST_2 = counts(2816, 162, 31, 3139);
const REQUEST_3 = counts(2978, 52, 18, 3178);

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
  [2, model({ type: "text", role: "user", text: input })],
];

/**
 * A thought or a reply as it streams: `start` once the first token is out (`wait` after the
 * previous step), one `delta` per piece at the given gaps, then `stop` after `tail`.
 */
const streamed = (
  kind: "partial_text" | "partial_thinking",
  wait: number,
  pieces: readonly (readonly [gap: number, piece: string])[],
  tail: number,
): Script[] => {
  const fragment = (event_type: StreamPhase, piece: string): Draft =>
    kind === "partial_text"
      ? model({ type: kind, role: "assistant", event_type, text: piece })
      : model({ type: kind, role: "assistant", event_type, thinking: piece });
  return [
    [wait, fragment("start", "")],
    ...pieces.map(([gap, piece]): Script => [gap, fragment("delta", piece)]),
    [tail, fragment("stop", "")],
  ];
};

const joined = (pieces: readonly (readonly [number, string])[]) =>
  pieces.map(([, piece]) => piece).join("");

const THINKING = [
  [1300, "The user wants the current time. I'll read the server's clock with date."],
] as const;
const ANSWER = [
  [600, "It's 09:41 UTC on Wednesday, October 21, 2026, by the server's clock."],
] as const;
const CLOCK = "Wed Oct 21 09:41:11 UTC 2026\n";

const callSteps = (): Script[] => [
  [
    110,
    model({
      type: "partial_tool_call",
      role: "assistant",
      event_type: "start",
      name: "exec_command",
      arguments: "",
      tool_call_id: CALL_ID,
    }),
  ],
  [
    140,
    model({
      type: "partial_tool_call",
      role: "assistant",
      event_type: "delta",
      name: "",
      arguments: DATE_ARGUMENTS,
      tool_call_id: CALL_ID,
    }),
  ],
  [
    30,
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
    }),
  ],
];

const outputFragment = (event_type: StreamPhase, output: string): Draft =>
  model({
    type: "partial_tool_call_output",
    role: "user",
    event_type,
    output,
    tool_call_id: CALL_ID,
  });

/**
 * "What time is it now?" as the Session's first message: the model thinks, calls `date`, reads the
 * clock in a second Request and answers.
 */
const FIRST_RUN = timed("2026-10-21T09:41:07.000Z", EPOCH, [
  ping,
  sessionMeta(SESSION),
  ...taskOpening("What time is it now?"),
  [8, record({ type: "request_begin", thinking_level: "medium" })],
  ...streamed("partial_thinking", 1380, THINKING, 1300),
  [2, model({ type: "thinking", role: "assistant", thinking: joined(THINKING) })],
  ...callSteps(),
  // The tool starts while its Request is still open, and finishes after the Request closed.
  [20, outputFragment("start", "")],
  [4, record({ type: "token_usage", session: REQUEST_1, request: REQUEST_1 })],
  [2, record({ type: "request_end", status: "completed" })],
  [150, outputFragment("delta", CLOCK)],
  [30, outputFragment("stop", "")],
  [
    2,
    model({
      type: "tool_call_output",
      role: "user",
      output: CLOCK,
      tool_call_id: CALL_ID,
      status: "completed",
    }),
  ],
  [10, record({ type: "request_begin", thinking_level: "medium" })],
  ...streamed("partial_text", 1250, ANSWER, 620),
  [2, model({ type: "text", role: "assistant", text: joined(ANSWER) })],
  [8, record({ type: "token_usage", session: add(REQUEST_1, REQUEST_2), request: REQUEST_2 })],
  [2, record({ type: "request_end", status: "completed" })],
  [8, record({ type: "task_end" })],
  [2, { done: true }],
]);

const recordCount = (steps: readonly RunStep[]) =>
  steps.filter((step) => step.kind === "record").length;

const FRENCH = [[500, "Il est 9 h 41 UTC, le mercredi 21 octobre 2026."]] as const;

/** A follow-up on the same Session: no `session_meta`, one Request, the numbering carried on. */
const CONTINUE_RUN = timed(
  "2026-10-21T09:41:20.000Z",
  EPOCH,
  [
    ping,
    ...taskOpening("Now say it in French."),
    [8, record({ type: "request_begin", thinking_level: "medium" })],
    ...streamed("partial_text", 1150, FRENCH, 420),
    [2, model({ type: "text", role: "assistant", text: joined(FRENCH) })],
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
const ABORT_AFTER_MS = 2600;

const HISTORY = [
  [640, "The first mechanical clocks appeared"],
  [560, " in European monasteries around"],
] as const;

/**
 * A long answer the caller stops mid-reply: the abort request lands, the reply's fragments close
 * with their `stop` and no complete text, the Request and then the run are marked aborted, and
 * the Task still closes before `[DONE]`.
 */
const INTERRUPT_RUN = timed(
  "2026-10-21T09:41:30.000Z",
  EPOCH,
  [
    ping,
    ...taskOpening("Explain clocks in depth."),
    [8, record({ type: "request_begin", thinking_level: "medium" })],
    // The reply's fragments; the abort lands before it ends, so its stop closes it with no text.
    ...streamed("partial_text", 1320, HISTORY, 76).slice(0, -1),
    [66, { request: { method: "POST", path: `/sessions/${SESSION}/abort` } }],
    [10, model({ type: "partial_text", role: "assistant", event_type: "stop", text: "" })],
    // A Request that did not complete carries its attempt ordinal; an interruption has no error.
    [6, record({ type: "request_end", status: "aborted", attempt: 1 })],
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
