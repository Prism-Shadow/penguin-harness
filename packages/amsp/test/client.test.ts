/**
 * AgentClient against a scripted AMSP server (the package's one fetch fake).
 *
 * Runs and their streams
 * - Iterating a run yields the server's events in order and stops at [DONE]: nothing after it is
 *   read, and the connection is closed.
 * - A run POSTs its input, and the Session to continue, as JSON to the Agent's runs route, with
 *   the key as a Bearer token and the caller's extra headers; a keyless client sends no
 *   Authorization.
 * - result() joins the main Session's assistant texts and keeps every complete item; deltas, user
 *   texts, a subagent's texts and compaction summaries stay out of the text.
 * - A run that ends fatal resolves with that status and error; it does not reject.
 * - session resolves from run.started while the server still holds back the first content event.
 * - Keep-alive comments, CRLF framing, chunks split mid-event and a data block spread over two
 *   lines leave the events intact.
 * - An event type the client does not know reaches the iterator and the items.
 * - Leaving the loop early stops the iteration, not the run: the connection stays open and
 *   result() still resolves.
 * - Events are kept for an iteration that starts after the run ended, and a finished iteration
 *   keeps answering done.
 * - A run's events can be iterated once.
 *
 * Failures
 * - A refusal before the stream rejects the run, its session and its iteration with an
 *   AmspHttpError carrying the status and the envelope's code; a body that is not the envelope
 *   reads as `http_error` with the start of the body.
 * - A stream that ends, says [DONE] or breaks before run.done is an AmspStreamError, raised by
 *   the iteration after the events that did arrive; one that ends or breaks after run.done still
 *   resolves.
 * - A 200 answer that is not an event stream (saying what came instead), and a block that is not
 *   an AMSP event, are AmspStreamErrors.
 *
 * Approvals
 * - An approval request is answered by POST with the callback's decision, even when the caller
 *   only awaits the result; no callback, or a throwing one, answers deny.
 * - An approval someone else answered first does not fail the run, and an answer that fails after
 *   the run completed leaves it completed.
 * - An approval the server refuses to take ends the run with that refusal and closes the
 *   connection, so the server aborts the run instead of waiting for good.
 *
 * Aborts
 * - Aborting the signal mid-stream closes the connection and rejects with the signal's AbortError,
 *   whether the fetch errors the body itself or leaves it to the reader.
 * - The iteration stops at once when the signal aborts, and events not yet read are dropped.
 * - A signal that aborts as the response arrives rejects without waiting for the stream; one
 *   aborted before the run sends nothing.
 * - run.abort() asks the server to abort and the stream ends with run.done aborted; on a run that
 *   is over, or was refused, it sends nothing.
 *
 * The rest of the surface
 * - agent() and session() read the Agent and one of its Sessions; an unknown Session is an
 *   AmspHttpError.
 * - abort(sessionId) says whether a run was interrupted; approve() posts a decision and reports
 *   one already taken as approval_not_found.
 * - parseArguments returns the arguments object, {} for none, and null for anything malformed.
 * - An agent reference that is not <projectId>/<agentId> is refused at construction.
 * - A fetch handed to the client carries its requests instead of the global one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentClient,
  AmspHttpError,
  AmspStreamError,
  parseArguments,
  type AmspEvent,
  type RunOptions,
} from "../src/index.js";
import {
  BASE_URL,
  DONE,
  createFetchFake,
  frame,
  gate,
  never,
  type FetchFake,
  type Step,
} from "./helpers/fetch-fake.js";

const AT = "2026-10-07T10:00:00.000Z";
const SESSION = "session-2026-10-07-10-00-00-3f9a1c2e";
const KEY = "test-agent-key";
const RUNS = "/agents/demo/coder/runs";
const APPROVAL = `/sessions/${SESSION}/approvals/call_1`;
const USAGE = { cache_read: 0, cache_write: 0, output: 2, total: 412 };

function ev(type: string, fields: Record<string, unknown> = {}): AmspEvent {
  return { type, at: AT, ...fields } as AmspEvent;
}

const started = ev("run.started", { session_id: SESSION, agent: "demo/coder" });
const runDone = (fields: Record<string, unknown> = {}) =>
  ev("run.done", {
    status: "completed",
    requests: 1,
    usage: USAGE,
    session_usage: USAGE,
    ...fields,
  });

/** A plain answer, as the protocol reference shows it. */
const PLAIN = [
  started,
  ev("request.started", { request: 1 }),
  ev("text.delta", { role: "assistant", text: "" }),
  ev("text.delta", { role: "assistant", text: "Hello" }),
  ev("text.delta", { role: "assistant", text: "!" }),
  ev("text.done", { role: "assistant", text: "Hello!", stop_reason: "completed" }),
  ev("request.done", { request: 1, status: "completed", usage: USAGE }),
  runDone(),
];

const TOOL_CALL = ev("tool_call.done", {
  tool_call_id: "call_1",
  name: "exec_command",
  arguments: '{"command":"ls"}',
  stop_reason: "completed",
});
const APPROVAL_REQUESTED = ev("approval.requested", {
  tool_call: { tool_call_id: "call_1", name: "exec_command", arguments: '{"command":"ls"}' },
});

/** A tool call the server holds for approval until `answered` settles, then runs. */
function approvalScript(answered: Promise<unknown>): Step[] {
  return [
    frame(started),
    frame(ev("request.started", { request: 1 })),
    frame(TOOL_CALL),
    frame(ev("request.done", { request: 1, status: "completed", usage: USAGE })),
    frame(APPROVAL_REQUESTED),
    answered,
    frame(ev("approval.decided", { tool_call_id: "call_1", decision: "allow" })),
    frame(ev("tool_result.done", { tool_call_id: "call_1", output: "README.md\n" })),
    frame(runDone({ requests: 1 })),
    DONE,
  ];
}

async function collect(run: AsyncIterable<AmspEvent>): Promise<AmspEvent[]> {
  const events: AmspEvent[] = [];
  for await (const event of run) events.push(event);
  return events;
}

let fake: FetchFake;
let client: AgentClient;

beforeEach(() => {
  fake = createFetchFake();
  vi.stubGlobal("fetch", fake.fetch);
  client = new AgentClient({ baseUrl: BASE_URL, agent: "demo/coder", apiKey: KEY });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a run's stream", () => {
  it("yields the server's events in order and stops at [DONE]", async () => {
    const served = fake.stream("POST", RUNS, [
      ...PLAIN.map(frame),
      DONE,
      frame(ev("text.done", { role: "assistant", text: "after the end" })),
    ]);

    expect(await collect(client.run({ input: "hi" }))).toEqual(PLAIN);
    expect(served.closed).toBe(true);
  });

  it("posts the input and the Session to continue to the Agent's runs route, with the key and the caller's headers", async () => {
    client = new AgentClient({
      baseUrl: `${BASE_URL}/`,
      agent: "demo/coder",
      apiKey: KEY,
      headers: { "X-Request-Source": "nightly-report" },
    });
    fake.stream("POST", RUNS, [...PLAIN.map(frame), DONE]);
    const input: RunOptions["input"] = [
      { type: "text", text: "What is in this picture?" },
      { type: "image_url", image_url: "data:image/png;base64,iVBORw0KGgo=" },
    ];

    await client.ask({ sessionId: SESSION, input });

    expect(fake.calls).toHaveLength(1);
    const [call] = fake.calls;
    expect(call).toMatchObject({
      method: "POST",
      path: RUNS,
      body: { session_id: SESSION, input },
    });
    expect(call!.headers.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(call!.headers.get("content-type")).toBe("application/json");
    expect(call!.headers.get("accept")).toBe("text/event-stream");
    expect(call!.headers.get("x-request-source")).toBe("nightly-report");
  });

  it("sends no Authorization from a keyless client", async () => {
    client = new AgentClient({ baseUrl: BASE_URL, agent: "demo/coder" });
    fake.stream("POST", RUNS, [...PLAIN.map(frame), DONE]);

    await client.ask({ input: "hi" });

    expect(fake.calls[0]!.headers.has("authorization")).toBe(false);
    expect(fake.calls[0]!.body).toEqual({ input: "hi" });
  });

  it("joins the main Session's assistant texts in result(), leaving deltas, user texts, subagent texts and summaries out", async () => {
    const events = [
      started,
      ev("text.done", { role: "user", text: "Check the tests too", sender: "user" }),
      ev("request.started", { request: 1 }),
      ev("text.delta", { role: "assistant", text: "First." }),
      ev("text.done", { role: "assistant", text: "First.", stop_reason: "completed" }),
      ev("text.done", { role: "assistant", text: "", stop_reason: "completed" }),
      TOOL_CALL,
      ev("request.done", { request: 1, status: "completed", usage: USAGE }),
      ev("text.done", { role: "assistant", text: "Subagent's answer", origin: ["session-child"] }),
      ev("compaction.started", { reason: "context", mode: "summarize", context: 900, turns: 4 }),
      ev("summary.delta", { text: "So far" }),
      ev("summary.done", { text: "So far", stop_reason: "completed" }),
      ev("compaction.done", { reason: "context", mode: "summarize", status: "completed" }),
      ev("request.started", { request: 2 }),
      ev("text.done", { role: "assistant", text: "Second.", stop_reason: "completed" }),
      ev("request.done", { request: 2, status: "completed", usage: USAGE }),
      runDone({ requests: 2, session_usage: null }),
    ];
    fake.stream("POST", RUNS, [...events.map(frame), DONE]);

    const result = await client.ask({ input: "hi" });

    expect(result).toMatchObject({
      status: "completed",
      sessionId: SESSION,
      text: "First.\n\nSecond.",
      usage: USAGE,
      sessionUsage: null,
      requests: 2,
    });
    expect(result).not.toHaveProperty("error");
    expect(result.items.map((item) => item.type)).toEqual([
      "run.started",
      "text.done",
      "request.started",
      "text.done",
      "text.done",
      "tool_call.done",
      "request.done",
      "text.done",
      "compaction.started",
      "summary.done",
      "compaction.done",
      "request.started",
      "text.done",
      "request.done",
      "run.done",
    ]);
  });

  it("resolves a run that ended fatal with its status and error", async () => {
    const error = { code: "auth", message: "401 invalid x-api-key" };
    fake.stream("POST", RUNS, [
      frame(started),
      frame(ev("request.started", { request: 1 })),
      frame(ev("request.done", { request: 1, status: "fatal", usage: null, error, attempt: 1 })),
      frame(runDone({ status: "fatal", error })),
      DONE,
    ]);

    await expect(client.ask({ input: "hi" })).resolves.toMatchObject({
      status: "fatal",
      error,
      text: "",
    });
  });

  it("resolves the session from run.started while the server holds back the first content event", async () => {
    const hold = gate();
    fake.stream("POST", RUNS, [frame(started), hold.promise, ...PLAIN.slice(1).map(frame), DONE]);

    const run = client.run({ input: "hi" });

    await expect(run.session).resolves.toBe(SESSION);
    hold.open();
    await expect(run.result()).resolves.toMatchObject({ sessionId: SESSION, text: "Hello!" });
  });

  it("reads events through keep-alive comments, CRLF framing, split chunks and a two-line data block", async () => {
    const twoLines =
      'data: {"type":"text.done","at":"2026-10-07T10:00:00.000Z",\r\ndata: "role":"assistant","text":"Hello!","stop_reason":"completed"}\r\n\r\n';
    const wire = [
      frame(started),
      ": keep-alive\n\n",
      frame(ev("request.started", { request: 1 })),
      twoLines,
      ": keep-alive\n\n",
      frame(runDone()),
      DONE,
    ]
      .join("")
      .replaceAll(/(?<!\r)\n/g, "\r\n");
    const chunks = wire.match(/[\s\S]{1,7}/g)!;
    fake.stream("POST", RUNS, chunks);

    const events = await collect(client.run({ input: "hi" }));

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "request.started",
      "text.done",
      "run.done",
    ]);
    expect(events[2]).toMatchObject({ role: "assistant", text: "Hello!" });
  });

  it("passes an event type it does not know to the iterator and the items", async () => {
    const unknown = ev("plan.updated", { steps: ["read", "summarize"] });
    fake.stream("POST", RUNS, [frame(started), frame(unknown), frame(runDone()), DONE]);
    const run = client.run({ input: "hi" });

    expect(await collect(run)).toContainEqual(unknown);
    expect((await run.result()).items).toContainEqual(unknown);
  });

  it("keeps the run going when the loop is left early, so result() still resolves", async () => {
    const hold = gate();
    const served = fake.stream("POST", RUNS, [
      frame(started),
      hold.promise,
      ...PLAIN.slice(1).map(frame),
      DONE,
    ]);
    const run = client.run({ input: "hi" });

    for await (const event of run) {
      expect(event.type).toBe("run.started");
      break;
    }
    expect(served.closed).toBe(false);
    hold.open();

    await expect(run.result()).resolves.toMatchObject({ status: "completed", text: "Hello!" });
    expect(fake.calls.map((call) => call.path)).toEqual([RUNS]);
  });

  it("keeps every event for an iteration that starts after the run ended", async () => {
    fake.stream("POST", RUNS, [...PLAIN.map(frame), DONE]);
    const run = client.run({ input: "hi" });

    await run.result();

    expect(await collect(run)).toEqual(PLAIN);
  });

  it("keeps answering done once the iteration has finished", async () => {
    fake.stream("POST", RUNS, [...PLAIN.map(frame), DONE]);
    const iterator = client.run({ input: "hi" })[Symbol.asyncIterator]();
    while (!(await iterator.next()).done);

    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
  });

  it("refuses to iterate a run's events twice", async () => {
    fake.stream("POST", RUNS, [...PLAIN.map(frame), DONE]);
    const run = client.run({ input: "hi" });
    await collect(run);

    expect(() => run[Symbol.asyncIterator]()).toThrow(TypeError);
  });
});

describe("a run that fails", () => {
  it.each([
    {
      answer: "the error envelope",
      status: 401,
      body: '{"error":{"code":"unauthorized","message":"This Agent requires an API key."}}',
      expected: { status: 401, code: "unauthorized", message: "This Agent requires an API key." },
    },
    {
      answer: "an envelope without a message",
      status: 403,
      body: '{"error":{"code":"agent_api_disabled"}}',
      expected: { status: 403, code: "agent_api_disabled", message: "agent_api_disabled" },
    },
    {
      answer: "a body that is not the envelope",
      status: 502,
      body: "<html>Bad Gateway</html>",
      expected: { status: 502, code: "http_error", message: "HTTP 502: <html>Bad Gateway</html>" },
    },
  ])(
    "rejects the run, its session and its iteration with an AmspHttpError read from $answer",
    async ({ status, body, expected }) => {
      fake.text("POST", RUNS, status, body, "application/json");

      const run = client.run({ input: "hi" });

      for (const outcome of [run.result(), run.session, collect(run)]) {
        const error = await outcome.then(
          () => null,
          (err: unknown) => err,
        );
        expect(error).toBeInstanceOf(AmspHttpError);
        expect(error).toMatchObject(expected);
      }
    },
  );

  it.each([
    { how: "ends", tail: [] as Step[] },
    { how: "says [DONE]", tail: [DONE] as Step[] },
    { how: "breaks", tail: [{ fail: new TypeError("terminated") }] as Step[] },
  ])(
    "is an AmspStreamError, after the events that did arrive, when the stream $how before run.done",
    async ({ tail }) => {
      fake.stream("POST", RUNS, [...PLAIN.slice(0, 4).map(frame), ...tail]);
      const run = client.run({ input: "hi" });

      await expect(run.result()).rejects.toBeInstanceOf(AmspStreamError);
      const seen: AmspEvent[] = [];
      const iteration = (async () => {
        for await (const event of run) seen.push(event);
      })();
      await expect(iteration).rejects.toBeInstanceOf(AmspStreamError);
      expect(seen).toEqual(PLAIN.slice(0, 4));
    },
  );

  it.each([
    { how: "ends", tail: [] as Step[] },
    { how: "breaks", tail: [{ fail: new TypeError("terminated") }] as Step[] },
  ])("still resolves when the stream $how after run.done", async ({ tail }) => {
    fake.stream("POST", RUNS, [...PLAIN.map(frame), ...tail]);

    await expect(client.ask({ input: "hi" })).resolves.toMatchObject({ status: "completed" });
  });

  it.each([
    {
      answer: "an HTML page",
      serve: (f: FetchFake) => f.text("POST", RUNS, 200, "<!doctype html>", "text/html"),
      named: "text/html",
    },
    {
      answer: "an empty answer",
      serve: (f: FetchFake) => f.empty("POST", RUNS, 200),
      named: "without a content type",
    },
  ])(
    "is an AmspStreamError saying what came instead when a 200 answer is $answer",
    async ({ serve, named }) => {
      serve(fake);

      const error = await client.ask({ input: "hi" }).catch((err: unknown) => err);

      expect(error).toBeInstanceOf(AmspStreamError);
      expect((error as Error).message).toContain(named);
    },
  );

  it.each([
    { block: "not JSON", data: "data: {not json\n\n" },
    { block: "JSON without a type", data: 'data: {"session_id":"x"}\n\n' },
  ])("is an AmspStreamError when a block is $block", async ({ data }) => {
    const served = fake.stream("POST", RUNS, [frame(started), data, never()]);

    await expect(client.ask({ input: "hi" })).rejects.toBeInstanceOf(AmspStreamError);
    expect(served.closed).toBe(true);
  });
});

describe("approvals", () => {
  it.each([
    { callback: "no callback", onApproval: undefined, decision: "deny" },
    { callback: "a callback that allows", onApproval: () => "allow" as const, decision: "allow" },
    {
      callback: "an async callback that denies",
      onApproval: async () => "deny" as const,
      decision: "deny",
    },
    {
      callback: "a callback that throws",
      onApproval: () => {
        throw new Error("no terminal to ask");
      },
      decision: "deny",
    },
  ])(
    "answers with $decision for $callback, while the caller only awaits the result",
    async ({ onApproval, decision }) => {
      fake.empty("POST", APPROVAL, 204);
      fake.stream("POST", RUNS, approvalScript(fake.requested("POST", APPROVAL)));

      await expect(client.ask({ input: "list the files", onApproval })).resolves.toMatchObject({
        status: "completed",
      });

      const answer = fake.calls.find((call) => call.path === APPROVAL)!;
      expect(answer.body).toEqual({ decision });
      expect(answer.headers.get("authorization")).toBe(`Bearer ${KEY}`);
    },
  );

  it("hands the callback the request and the Session it belongs to", async () => {
    fake.empty("POST", APPROVAL, 204);
    fake.stream("POST", RUNS, approvalScript(fake.requested("POST", APPROVAL)));
    const asked: unknown[] = [];

    await client.ask({
      input: "list the files",
      onApproval: (request, ctx) => {
        asked.push({ request, ctx });
        return parseArguments(request.tool_call)?.command === "ls" ? "allow" : "deny";
      },
    });

    expect(asked).toEqual([{ request: APPROVAL_REQUESTED, ctx: { sessionId: SESSION } }]);
    expect(fake.calls.find((call) => call.path === APPROVAL)!.body).toEqual({ decision: "allow" });
  });

  it("finishes the run when someone else answered the approval first", async () => {
    fake.json("POST", APPROVAL, 404, {
      error: { code: "approval_not_found", message: "This approval was already decided." },
    });
    fake.stream("POST", RUNS, approvalScript(fake.requested("POST", APPROVAL)));

    await expect(
      client.ask({ input: "list the files", onApproval: () => "allow" }),
    ).resolves.toMatchObject({
      status: "completed",
    });
  });

  it("leaves a completed run as it was when an answer fails after the run ended", async () => {
    const late = gate();
    fake.json(
      "POST",
      APPROVAL,
      500,
      { error: { code: "internal", message: "boom" } },
      late.promise,
    );
    fake.stream("POST", RUNS, [
      frame(started),
      frame(APPROVAL_REQUESTED),
      fake.requested("POST", APPROVAL),
      frame(ev("approval.decided", { tool_call_id: "call_1", decision: "deny" })),
      frame(runDone()),
      DONE,
    ]);
    const run = client.run({ input: "list the files" });
    await expect(run.result()).resolves.toMatchObject({ status: "completed" });

    const answer = await fake.requested("POST", APPROVAL);
    const failed = new Promise((resolve) => answer.signal!.addEventListener("abort", resolve));
    late.open();
    await failed;

    expect((await collect(run)).map((event) => event.type)).toEqual([
      "run.started",
      "approval.requested",
      "approval.decided",
      "run.done",
    ]);
  });

  it("ends the run with the server's refusal to take an answer, and closes the connection", async () => {
    fake.json("POST", APPROVAL, 401, {
      error: { code: "unauthorized", message: "This Agent requires an API key." },
    });
    const served = fake.stream("POST", RUNS, approvalScript(never()));

    await expect(client.ask({ input: "list the files" })).rejects.toMatchObject({
      status: 401,
      code: "unauthorized",
    });
    expect(served.closed).toBe(true);
  });
});

describe("aborting", () => {
  it.each([
    { fetch: "a fetch that errors the body on abort", abortErrorsBody: true },
    { fetch: "a fetch that leaves the body to its reader", abortErrorsBody: false },
  ])(
    "closes the connection and rejects with the AbortError when the signal aborts mid-stream, through $fetch",
    async ({ abortErrorsBody }) => {
      const controller = new AbortController();
      const served = fake.stream(
        "POST",
        RUNS,
        [
          ...PLAIN.slice(0, 4).map(frame),
          () => {
            controller.abort();
            return never();
          },
        ],
        { abortErrorsBody },
      );
      const run = client.run({ input: "hi", signal: controller.signal });

      const error = await run.result().catch((err: unknown) => err);

      expect(error).toBe(controller.signal.reason);
      expect(error).toMatchObject({ name: "AbortError" });
      await expect(collect(run)).rejects.toBe(controller.signal.reason);
      expect(served.closed).toBe(true);
    },
  );

  it("stops the iteration at once when the loop aborts the signal", async () => {
    fake.stream("POST", RUNS, [...PLAIN.map(frame), DONE]);
    const controller = new AbortController();
    const run = client.run({ input: "hi", signal: controller.signal });

    const seen: string[] = [];
    const iteration = (async () => {
      for await (const event of run) {
        seen.push(event.type);
        if (event.type === "text.delta") controller.abort();
      }
    })();

    const error = await iteration.catch((err: unknown) => err);

    expect(error).toBe(controller.signal.reason);
    expect(seen).toEqual(["run.started", "request.started", "text.delta"]);
  });

  it("drops the events not yet read when the signal aborts while the reader lags behind", async () => {
    fake.stream("POST", RUNS, [...PLAIN.slice(0, 4).map(frame), never()]);
    const controller = new AbortController();
    const run = client.run({ input: "hi", signal: controller.signal });
    await run.session;

    controller.abort();
    await expect(run.result()).rejects.toBe(controller.signal.reason);

    const seen: AmspEvent[] = [];
    const iteration = (async () => {
      for await (const event of run) seen.push(event);
    })();
    await expect(iteration).rejects.toBe(controller.signal.reason);
    expect(seen).toEqual([]);
  });

  it("rejects without waiting for the stream when the signal aborts as the response arrives", async () => {
    const served = fake.stream("POST", RUNS, [never()]);
    const controller = new AbortController();
    client = new AgentClient({
      baseUrl: BASE_URL,
      agent: "demo/coder",
      apiKey: KEY,
      fetch: async (input, init) => {
        const response = await fake.fetch(input, init);
        controller.abort();
        return response;
      },
    });

    const error = await client.ask({ input: "hi", signal: controller.signal }).catch((err) => err);

    expect(error).toBe(controller.signal.reason);
    expect(served.closed).toBe(true);
  });

  it("sends nothing for a signal aborted before the run", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(client.ask({ input: "hi", signal: controller.signal })).rejects.toBe(
      controller.signal.reason,
    );
    expect(fake.calls).toEqual([]);
  });

  it("asks the server to abort with run.abort(), and the stream ends with run.done aborted", async () => {
    const abortPath = `/sessions/${SESSION}/abort`;
    const userAbort = { code: "user_abort", message: "Aborted by the API caller." };
    fake.empty("POST", abortPath, 202);
    fake.stream("POST", RUNS, [
      ...PLAIN.slice(0, 4).map(frame),
      fake.requested("POST", abortPath),
      frame(ev("text.done", { role: "assistant", text: "Hello", stop_reason: "aborted" })),
      frame(ev("request.done", { request: 1, status: "aborted", usage: null, attempt: 1 })),
      frame(runDone({ status: "aborted", error: userAbort, session_usage: null })),
      DONE,
    ]);
    const run = client.run({ input: "hi" });

    await run.session;
    await run.abort();

    await expect(run.result()).resolves.toMatchObject({
      status: "aborted",
      error: userAbort,
      text: "Hello",
    });
  });

  it.each([
    {
      run: "a run that is over",
      script: (f: FetchFake) => f.stream("POST", RUNS, [...PLAIN.map(frame), DONE]),
    },
    {
      run: "a refused run",
      script: (f: FetchFake) =>
        f.json("POST", RUNS, 429, { error: { code: "too_many_runs", message: "Busy." } }),
    },
  ])("sends nothing when run.abort() is called on $run", async ({ script }) => {
    script(fake);
    const run = client.run({ input: "hi" });
    await run.result().catch(() => {});

    await run.abort();

    expect(fake.calls.map((call) => call.path)).toEqual([RUNS]);
  });
});

describe("the rest of the client", () => {
  it("reads the Agent and one of its Sessions, and reports an unknown Session as an AmspHttpError", async () => {
    const agent = { id: "demo/coder", name: "Coder", description: "Writes and reviews code." };
    const session = {
      id: SESSION,
      agent: "demo/coder",
      status: "idle",
      provider: "deepseek",
      model_id: "deepseek-chat",
      created_at: AT,
      last_active_at: AT,
    };
    fake.json("GET", "/agents/demo/coder", 200, { agent });
    fake.json("GET", `/sessions/${SESSION}`, 200, { session });
    fake.json("GET", "/sessions/session-unknown", 404, {
      error: { code: "session_not_found", message: "No such API Session." },
    });

    await expect(client.agent()).resolves.toEqual(agent);
    await expect(client.session(SESSION)).resolves.toEqual(session);
    await expect(client.session("session-unknown")).rejects.toMatchObject({
      status: 404,
      code: "session_not_found",
    });
  });

  it("says whether abort(sessionId) interrupted a run", async () => {
    fake.empty("POST", `/sessions/${SESSION}/abort`, 202);
    fake.empty("POST", "/sessions/session-idle/abort", 204);

    await expect(client.abort(SESSION)).resolves.toBe(true);
    await expect(client.abort("session-idle")).resolves.toBe(false);
  });

  it("posts a decision with approve(), and reports one already taken as approval_not_found", async () => {
    fake.empty("POST", APPROVAL, 204);
    fake.json("POST", `/sessions/${SESSION}/approvals/call_2`, 404, {
      error: { code: "approval_not_found", message: "This approval was already decided." },
    });

    await client.approve(SESSION, "call_1", "allow");
    await expect(client.approve(SESSION, "call_2", "deny")).rejects.toMatchObject({
      status: 404,
      code: "approval_not_found",
    });
    expect(fake.calls.map((call) => [call.path, call.body])).toEqual([
      [APPROVAL, { decision: "allow" }],
      [`/sessions/${SESSION}/approvals/call_2`, { decision: "deny" }],
    ]);
  });

  it.each([
    { args: '{"command":"ls","timeout_ms":5000}', parsed: { command: "ls", timeout_ms: 5000 } },
    { args: "", parsed: {} },
    { args: '{"command":"l', parsed: null },
    { args: '["ls"]', parsed: null },
    { args: '"ls"', parsed: null },
    { args: "null", parsed: null },
  ])("parseArguments reads $args as $parsed", ({ args, parsed }) => {
    expect(
      parseArguments({ tool_call_id: "call_1", name: "exec_command", arguments: args }),
    ).toEqual(parsed);
  });

  it.each(["coder", "demo/", "/coder", "demo/coder/extra"])(
    "refuses the agent reference %j at construction",
    (agent) => {
      expect(() => new AgentClient({ baseUrl: BASE_URL, agent })).toThrow(TypeError);
    },
  );

  it("sends every request through a fetch handed to it instead of the global one", async () => {
    const own = createFetchFake();
    own.stream("POST", RUNS, [...PLAIN.map(frame), DONE]);
    client = new AgentClient({ baseUrl: BASE_URL, agent: "demo/coder", fetch: own.fetch });

    await expect(client.ask({ input: "hi" })).resolves.toMatchObject({ text: "Hello!" });
    expect(own.calls).toHaveLength(1);
    expect(fake.calls).toEqual([]);
  });
});
