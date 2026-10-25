/**
 * AgentClient against the package's fetch fake (helpers/fetch-fake.ts): a run's records, its
 * result, the approval loop, and the Agent API's other routes.
 *
 * Runs:
 * - Given a run stream, iterating it reads the records in order and none of its control frames;
 *   `session` resolves with the Session the run continues, and the request carries the input,
 *   that Session, the key and the caller's headers.
 * - Given a new Session's run, `session` resolves at its `session_meta`, not at the opening beat,
 *   and the result names that Session.
 * - Given `run()`, the result arrives with nothing kept to iterate.
 * - Given named events AMSP does not define and a record type the client does not know, the first
 *   are left out and the second is read like any record.
 * - Given a run's records, `result()` decides the status in the rule's order — an unclosed last
 *   `task_begin` or no Task at all, then an `abort` (the turn cap's included), then an
 *   unrecovered terminal record (an output cap the retries never got past included) — and nothing
 *   a subagent records decides it.
 * - Given a run with a compaction and a subagent, `text` is the main Session's answers without
 *   the summary or the child's, `usage` counts every request the child's included, and
 *   `sessionUsage` is the main Session's last count.
 * - Given a Request cut off at its output cap and retried, and one interrupted, `text` keeps only
 *   the completed Request's answer, though the others' texts have their records.
 *
 * Failures:
 * - Given a refusal before the stream, the run rejects with AmspHttpError and `session` with it.
 * - Given a stream that ends without `[DONE]`, or breaks, the run rejects with AmspStreamError;
 *   given a body that is not an event stream, or a new Session's stream with no `session_meta`,
 *   the same.
 * - Given the caller's signal aborting mid-run, the run rejects with its reason and the
 *   connection closes; `run.abort()` posts the Session's abort and the stream still ends.
 *
 * Approvals:
 * - Given a completed `tool_call` with no decision yet, one look at `approvals?wait=30` opens;
 *   the call it returns goes to `onApproval` once with its origin and Session, and the answer is
 *   posted; once the decision is on the stream no further look opens.
 * - Given a call the server decides itself, the open look is closed when its decision arrives and
 *   nothing is posted.
 * - Given no callback, or one that throws, the answer posted is `deny`.
 * - Given a call cut short (written whole, then its Request ends without completing), the look
 *   it opened closes at that `request_end`.
 * - Given a call someone else answered first (`approval_not_found`), the run goes on.
 *
 * The rest: `agent()`, `session()`, `messages()` with a page, `approvals()` with a wait,
 * `abort()` and `approve()` reach their routes; `parseArguments` reads a call's arguments.
 */
import { describe, expect, it } from "vitest";
import { AgentClient, AmspHttpError, AmspStreamError, parseArguments } from "../src/index.js";
import type { AmspRecord, RunResult, ToolCallPayload } from "../src/index.js";
import {
  BASE_URL,
  control,
  createFetchFake,
  DONE,
  frame,
  gate,
  never,
} from "./helpers/fetch-fake.js";
import type { FetchFake, Step } from "./helpers/fetch-fake.js";
import {
  abort,
  assistantText,
  compactionBegin,
  compactionEnd,
  counts,
  decision,
  ev,
  meta,
  partialText,
  partialToolCall,
  plainRun,
  requestBegin,
  requestEnd,
  taskBegin,
  taskEnd,
  toolCall,
  toolOutput,
  usage,
  userText,
} from "./helpers/streams.js";

const SID = "session-2026-10-23-10-00-00-0000aaaa";
const RUNS = "/agents/demo/coder/runs";
const APPROVALS = `/sessions/${SID}/approvals?wait=30`;
const answerPath = (id: string) => `/sessions/${SID}/approvals/${id}`;

function clientOf(fake: FetchFake, extra: Record<string, string> = {}): AgentClient {
  return new AgentClient({
    baseUrl: BASE_URL,
    agent: "demo/coder",
    apiKey: "penguin_key",
    fetch: fake.fetch,
    headers: extra,
  });
}

const PING = control("ping");

/** A run stream: the opening beat, the records with ids, then [DONE] unless `done` is false. */
function runBody(records: AmspRecord[], done = true): Step[] {
  return [PING, ...records.map((r, i) => frame(r, `ep-${i + 1}`)), ...(done ? [DONE] : [])];
}

/** A new Session's run stream opens: the beat, then the Session's session_meta. */
const opening = (): Step[] => [PING, frame(meta(SID), "ep-0")];

async function collect(iterable: AsyncIterable<AmspRecord>): Promise<AmspRecord[]> {
  const out: AmspRecord[] = [];
  for await (const r of iterable) out.push(r);
  return out;
}

const kind = (r: AmspRecord) => (r.payload as { type?: string }).type ?? r.type;

describe("a run", () => {
  it("reads the records in order without the control frames, and names the Session it continues", async () => {
    const fake = createFetchFake();
    const records = plainRun(SID);
    const steps = runBody(records);
    // A beat mid-run and a host's own event: neither is a record.
    steps.splice(4, 0, control("ping"), control("server_event", { type: "task_state" }));
    fake.stream("POST", RUNS, steps);
    const run = clientOf(fake, { "X-Trace": "t1" }).stream({ input: "Say hello", sessionId: SID });
    expect(await run.session).toBe(SID);
    expect(await collect(run)).toEqual(records);
    const call = fake.calls[0]!;
    expect(call.body).toEqual({ session_id: SID, input: "Say hello" });
    expect(call.headers.get("authorization")).toBe("Bearer penguin_key");
    expect(call.headers.get("x-trace")).toBe("t1");
    expect(call.headers.get("accept")).toBe("text/event-stream");
  });

  it("names a new Session at its session_meta, not at the opening beat", async () => {
    const fake = createFetchFake();
    const held = gate();
    const [beat, ...rest] = runBody(plainRun(SID));
    fake.stream("POST", RUNS, [beat!, held.promise, ...rest]);
    const run = clientOf(fake).stream({ input: "Say hello" });
    let named: string | null = null;
    void run.session.then((id) => (named = id));
    await fake.requested("POST", RUNS);
    await new Promise((r) => setTimeout(r, 0));
    expect(named).toBeNull();
    held.open();
    expect(await run.session).toBe(SID);
    expect((await run.result()).sessionId).toBe(SID);
  });

  it("run() resolves to the result alone", async () => {
    const fake = createFetchFake();
    fake.stream("POST", RUNS, runBody(plainRun(SID, "Hi there")));
    const result = await clientOf(fake).run({ input: "Say hello" });
    expect(result).toEqual({
      status: "completed",
      sessionId: SID,
      text: "Hi there",
      usage: counts(5, 45, 40),
      sessionUsage: counts(5, 45, 40),
      requests: 1,
    } satisfies RunResult);
  });

  it("reads a record type it does not know like any other", async () => {
    const fake = createFetchFake();
    const odd = ev({ type: "something_new", value: 1 });
    const records = [...plainRun(SID).slice(0, -1), odd, taskEnd()];
    fake.stream("POST", RUNS, runBody(records));
    const run = clientOf(fake).stream({ input: "x" });
    expect((await collect(run)).map(kind)).toContain("something_new");
    expect((await run.result()).status).toBe("completed");
  });

  const main = [taskBegin(), userText("go"), requestBegin()];
  it.each<[string, AmspRecord[], Pick<RunResult, "status" | "error">]>([
    [
      "the last task_begin left open: fatal, internal",
      [...main, assistantText("half"), requestEnd()],
      { status: "fatal", error: expect.objectContaining({ code: "internal" }) },
    ],
    [
      "no Task at all: fatal, internal",
      [userText("go")],
      { status: "fatal", error: expect.objectContaining({ code: "internal" }) },
    ],
    [
      "a second Task left open after a closed one: fatal",
      [...main, requestEnd(), taskEnd(), taskBegin(), userText("again")],
      { status: "fatal", error: expect.objectContaining({ code: "internal" }) },
    ],
    [
      "an abort: aborted, with its cause",
      [...main, requestEnd("aborted", { error_code: "user_abort" }), abort(), taskEnd()],
      { status: "aborted", error: { code: "user_abort", message: "The run was interrupted." } },
    ],
    [
      "a request that failed for good: its status and error",
      [...main, requestEnd("fatal", { error_code: "auth", error_message: "bad key" }), taskEnd()],
      { status: "fatal", error: { code: "auth", message: "bad key" } },
    ],
    [
      "a failure retried in the run, then an answer: completed",
      [
        ...main,
        requestEnd("retryable", { error_code: "timeout", retry_in_ms: 1000 }),
        requestBegin(),
        assistantText("ok"),
        requestEnd(),
        taskEnd(),
      ],
      { status: "completed" },
    ],
    [
      "a compaction that failed at a Task boundary, then a request: completed",
      [
        ...main,
        requestEnd(),
        compactionBegin(),
        compactionEnd("retryable", { error_code: "timeout" }),
        requestBegin(),
        assistantText("ok"),
        requestEnd(),
        taskEnd(),
      ],
      { status: "completed" },
    ],
    [
      "a compaction that failed last: its status",
      [
        ...main,
        requestEnd(),
        compactionBegin(),
        compactionEnd("fatal", { error_code: "rejected" }),
        taskEnd(),
      ],
      { status: "fatal", error: { code: "rejected", message: "" } },
    ],
    [
      "the turn cap's abort: aborted, max_turns",
      [
        ...main,
        assistantText("Working."),
        requestEnd(),
        abort("max_turns", { error_message: "reached max turns (1)" }),
        taskEnd(),
      ],
      { status: "aborted", error: { code: "max_turns", message: "reached max turns (1)" } },
    ],
    [
      "an attempt cut off at its output cap retried, then an answer: completed",
      [
        ...main,
        assistantText("Half an ans"),
        requestEnd("retryable", {
          error_code: "output_truncated",
          error_message: "cut",
          retry_in_ms: 2000,
        }),
        requestBegin(),
        assistantText("The answer."),
        requestEnd(),
        taskEnd(),
      ],
      { status: "completed" },
    ],
    [
      "an output cap the retries never got past: retryable, output_truncated",
      [
        ...main,
        requestEnd("retryable", {
          error_code: "output_truncated",
          error_message: "cut",
          attempt: 6,
        }),
        taskEnd(),
      ],
      { status: "retryable", error: { code: "output_truncated", message: "cut" } },
    ],
    [
      "a subagent's abort and failure: completed",
      [
        ...main,
        ev({ type: "abort", error_code: "user_abort" }, ["child-1"]),
        requestEnd("fatal", { error_code: "auth" }, ["child-1"]),
        assistantText("done"),
        requestEnd(),
        taskEnd(),
      ],
      { status: "completed" },
    ],
  ])("decides the status: %s", async (_name, records, expected) => {
    const fake = createFetchFake();
    fake.stream("POST", RUNS, runBody(records));
    const result = await clientOf(fake).run({ input: "go", sessionId: SID });
    expect({ status: result.status, ...(result.error ? { error: result.error } : {}) }).toEqual(
      expected,
    );
  });

  it("keeps the text of a Request that did not complete out of the answer", async () => {
    const fake = createFetchFake();
    fake.stream(
      "POST",
      RUNS,
      runBody([
        taskBegin(),
        userText("go"),
        requestBegin(),
        assistantText("Half an ans"),
        requestEnd("retryable", { error_code: "output_truncated", retry_in_ms: 0 }),
        requestBegin(),
        assistantText("The answer."),
        requestEnd(),
        requestBegin(),
        assistantText("Interrupted mid-"),
        requestEnd("aborted"),
        abort(),
        taskEnd(),
      ]),
    );
    const result = await clientOf(fake).run({ input: "go", sessionId: SID });
    expect(result.status).toBe("aborted");
    expect(result.text).toBe("The answer.");
  });

  it("keeps a summary and a subagent's text out of the answer, and counts every request's usage", async () => {
    const fake = createFetchFake();
    const child = ["child-1"];
    fake.stream(
      "POST",
      RUNS,
      runBody([
        taskBegin(),
        userText("go"),
        requestBegin(),
        assistantText("First."),
        usage(counts(3, 30), counts(3, 30)),
        requestEnd(),
        requestBegin(child),
        assistantText("child says", child),
        usage(counts(2, 20), counts(2, 20), child),
        requestEnd("completed", {}, child),
        compactionBegin(),
        partialText("start"),
        partialText("delta", "summary"),
        assistantText("summary"),
        usage(counts(4, 40), counts(7, 70)),
        compactionEnd(),
        requestBegin(),
        assistantText("Second."),
        usage(counts(1, 10), counts(8, 80)),
        requestEnd(),
        taskEnd(),
      ]),
    );
    const result = await clientOf(fake).run({ input: "go", sessionId: SID });
    expect(result.text).toBe("First.\n\nSecond.");
    expect(result.usage).toEqual(counts(10, 100));
    expect(result.sessionUsage).toEqual(counts(8, 80));
    expect(result.requests).toBe(2);
  });
});

describe("a run that fails", () => {
  it("rejects a refusal before the stream with its status and code, and the session with it", async () => {
    const fake = createFetchFake();
    fake.json("POST", RUNS, 409, { error: { code: "task_in_progress", message: "Busy." } });
    const run = clientOf(fake).stream({ input: "x", sessionId: SID });
    await expect(run.result()).rejects.toMatchObject({
      name: "AmspHttpError",
      status: 409,
      code: "task_in_progress",
    });
    await expect(run.session).rejects.toBeInstanceOf(AmspHttpError);
  });

  it("rejects a stream that ends before [DONE], after reading what came", async () => {
    const fake = createFetchFake();
    fake.stream("POST", RUNS, runBody(plainRun(SID).slice(0, 4), false));
    const run = clientOf(fake).stream({ input: "x" });
    const read: AmspRecord[] = [];
    await expect(
      (async () => {
        for await (const r of run) read.push(r);
      })(),
    ).rejects.toBeInstanceOf(AmspStreamError);
    expect(read).toHaveLength(4);
    await expect(run.result()).rejects.toBeInstanceOf(AmspStreamError);
  });

  it("rejects a new Session's stream that reaches [DONE] without its session_meta", async () => {
    const fake = createFetchFake();
    fake.stream("POST", RUNS, runBody([taskBegin(), userText("go"), taskEnd()]));
    const run = clientOf(fake).stream({ input: "go" });
    await expect(run.result()).rejects.toBeInstanceOf(AmspStreamError);
    await expect(run.session).rejects.toBeInstanceOf(AmspStreamError);
  });

  it("rejects a connection that breaks mid-stream", async () => {
    const fake = createFetchFake();
    fake.stream("POST", RUNS, [
      ...opening(),
      frame(taskBegin(), "ep-1"),
      { fail: new TypeError("socket hang up") },
    ]);
    await expect(clientOf(fake).run({ input: "x" })).rejects.toBeInstanceOf(AmspStreamError);
  });

  it("rejects an answer that is not an event stream", async () => {
    const fake = createFetchFake();
    fake.text("POST", RUNS, 200, "<html>proxy</html>", "text/html");
    await expect(clientOf(fake).run({ input: "x" })).rejects.toBeInstanceOf(AmspStreamError);
  });

  it("rejects with the signal's reason and closes the connection when the caller aborts", async () => {
    const fake = createFetchFake();
    const served = fake.stream("POST", RUNS, [...opening(), frame(taskBegin(), "ep-1"), never()]);
    const controller = new AbortController();
    const run = clientOf(fake).stream({ input: "x", signal: controller.signal });
    await run.session;
    controller.abort(new Error("caller left"));
    await expect(run.result()).rejects.toThrow("caller left");
    expect(served.closed).toBe(true);
  });

  it("asks the server to abort with run.abort(), and the stream still ends with [DONE]", async () => {
    const fake = createFetchFake();
    fake.empty("POST", `/sessions/${SID}/abort`, 202);
    fake.stream("POST", RUNS, [
      ...opening(),
      frame(taskBegin(), "ep-1"),
      () => fake.requested("POST", `/sessions/${SID}/abort`),
      frame(abort(), "ep-2"),
      frame(taskEnd(), "ep-3"),
      DONE,
    ]);
    const run = clientOf(fake).stream({ input: "x" });
    await run.session;
    await run.abort();
    expect((await run.result()).status).toBe("aborted");
  });
});

describe("approvals", () => {
  const call = (id: string) => toolCall(id);
  const pending = (id: string, origin?: string[]) => ({
    tool_call: call(id).payload as ToolCallPayload,
    ...(origin ? { origin } : {}),
  });

  it("looks once for an undecided call, asks the callback once and posts its answer", async () => {
    const fake = createFetchFake();
    fake.json("GET", APPROVALS, 200, { approvals: [pending("call_1", ["child-1"])] });
    fake.empty("POST", answerPath("call_1"), 204);
    fake.stream("POST", RUNS, [
      ...opening(),
      frame(taskBegin(), "ep-1"),
      frame(toolCall("call_1", '{"cmd":"ls"}', ["child-1"]), "ep-2"),
      () => fake.requested("POST", answerPath("call_1")),
      frame(decision("call_1", "allow", ["child-1"]), "ep-3"),
      frame(toolOutput("call_1", "a.txt", ["child-1"]), "ep-4"),
      frame(taskEnd(), "ep-5"),
      DONE,
    ]);
    const asked: unknown[] = [];
    const result = await clientOf(fake).run({
      input: "x",
      onApproval: (toolCall, origin, ctx) => {
        asked.push([toolCall.tool_call_id, origin, ctx.sessionId]);
        return "allow";
      },
    });
    expect(result.status).toBe("completed");
    expect(asked).toEqual([["call_1", ["child-1"], SID]]);
    const looks = fake.calls.filter((c) => c.path === APPROVALS);
    expect(looks).toHaveLength(1);
    const answers = fake.calls.filter((c) => c.path === answerPath("call_1"));
    expect(answers.map((c) => c.body)).toEqual([{ decision: "allow" }]);
  });

  it("closes the open look when the server decides the call itself, and posts nothing", async () => {
    const fake = createFetchFake();
    fake.json("GET", APPROVALS, 200, { approvals: [] }, never());
    fake.stream("POST", RUNS, [
      ...opening(),
      frame(taskBegin(), "ep-1"),
      frame(call("call_1"), "ep-2"),
      () => fake.requested("GET", APPROVALS),
      frame(decision("call_1", "allow"), "ep-3"),
      frame(taskEnd(), "ep-4"),
      DONE,
    ]);
    await clientOf(fake).run({ input: "x", onApproval: () => "allow" });
    const look = fake.calls.find((c) => c.path === APPROVALS)!;
    expect(look.signal?.aborted).toBe(true);
    expect(fake.calls.some((c) => c.method === "POST" && c.path.includes("/approvals/"))).toBe(
      false,
    );
  });

  it.each([
    ["without a callback", undefined],
    [
      "when the callback throws",
      () => {
        throw new Error("no");
      },
    ],
  ])("answers deny %s", async (_name, onApproval) => {
    const fake = createFetchFake();
    fake.json("GET", APPROVALS, 200, { approvals: [pending("call_1")] });
    fake.empty("POST", answerPath("call_1"), 204);
    fake.stream("POST", RUNS, [
      ...opening(),
      frame(taskBegin(), "ep-1"),
      frame(call("call_1"), "ep-2"),
      () => fake.requested("POST", answerPath("call_1")),
      frame(decision("call_1", "deny"), "ep-3"),
      frame(taskEnd(), "ep-4"),
      DONE,
    ]);
    await clientOf(fake).run({ input: "x", ...(onApproval ? { onApproval } : {}) });
    expect(fake.calls.find((c) => c.path === answerPath("call_1"))?.body).toEqual({
      decision: "deny",
    });
  });

  it("closes the open look when the call's Request ends without completing", async () => {
    // A call the stream cut short is written whole with the arguments that arrived; its Request
    // then ends without completing, so it was never dispatched and no decision follows it.
    const fake = createFetchFake();
    fake.json("GET", APPROVALS, 200, { approvals: [] }, never());
    const lookClosed = () =>
      new Promise<void>((resolve) => {
        const signal = fake.calls.find((c) => c.path === APPROVALS)!.signal!;
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });
    fake.stream("POST", RUNS, [
      ...opening(),
      frame(taskBegin(), "ep-1"),
      frame(partialToolCall("call_1", "start"), "ep-2"),
      frame(partialToolCall("call_1", "delta", '{"cmd":'), "ep-3"),
      frame(partialToolCall("call_1", "stop"), "ep-4"),
      frame(toolCall("call_1", '{"cmd":'), "ep-5"),
      () => fake.requested("GET", APPROVALS),
      frame(requestEnd("aborted"), "ep-6"),
      lookClosed,
      frame(abort(), "ep-7"),
      frame(taskEnd(), "ep-8"),
      DONE,
    ]);
    const result = await clientOf(fake).run({ input: "x", onApproval: () => "allow" });
    expect(result.status).toBe("aborted");
    expect(fake.calls.filter((c) => c.path === APPROVALS)).toHaveLength(1);
    expect(fake.calls.some((c) => c.method === "POST" && c.path.includes("/approvals/"))).toBe(
      false,
    );
  });

  it("goes on when someone else answered first", async () => {
    const fake = createFetchFake();
    fake.json("GET", APPROVALS, 200, { approvals: [pending("call_1")] });
    fake.json("POST", answerPath("call_1"), 404, {
      error: { code: "approval_not_found", message: "Already decided." },
    });
    fake.stream("POST", RUNS, [
      ...opening(),
      frame(taskBegin(), "ep-1"),
      frame(call("call_1"), "ep-2"),
      () => fake.requested("POST", answerPath("call_1")),
      frame(decision("call_1", "allow"), "ep-3"),
      frame(taskEnd(), "ep-4"),
      DONE,
    ]);
    expect((await clientOf(fake).run({ input: "x", onApproval: () => "deny" })).status).toBe(
      "completed",
    );
  });

  it("does not look again while an answer is being decided", async () => {
    const fake = createFetchFake();
    // The server lists the call until the answer lands.
    fake.json("GET", APPROVALS, 200, { approvals: [pending("call_1")] });
    fake.empty("POST", answerPath("call_1"), 204);
    const human = gate();
    fake.stream("POST", RUNS, [
      ...opening(),
      frame(taskBegin(), "ep-1"),
      frame(call("call_1"), "ep-2"),
      () => fake.requested("POST", answerPath("call_1")),
      frame(decision("call_1", "allow"), "ep-3"),
      frame(taskEnd(), "ep-4"),
      DONE,
    ]);
    const run = clientOf(fake).stream({
      input: "x",
      onApproval: async () => {
        await human.promise;
        return "allow" as const;
      },
    });
    await fake.requested("GET", APPROVALS);
    await new Promise((r) => setTimeout(r, 0));
    human.open();
    await run.result();
    expect(fake.calls.filter((c) => c.path === APPROVALS)).toHaveLength(1);
  });
});

describe("the rest of the client", () => {
  it("reads the Agent, a Session, its history page and its pending approvals", async () => {
    const fake = createFetchFake();
    fake.json("GET", "/agents/demo/coder", 200, { agent: { id: "demo/coder", name: "Coder" } });
    fake.json("GET", `/sessions/${SID}`, 200, {
      session: { id: SID, agent: "demo/coder", status: "idle" },
    });
    fake.json("GET", `/sessions/${SID}/messages?before=2%3A4&limit=5`, 200, { messages: [] });
    fake.json("GET", `/sessions/${SID}/approvals?wait=5`, 200, { approvals: [] });
    const client = clientOf(fake);
    expect((await client.agent()).name).toBe("Coder");
    expect((await client.session(SID)).status).toBe("idle");
    expect(await client.messages(SID, { before: "2:4", limit: 5 })).toEqual({ messages: [] });
    expect(await client.approvals(SID, 5)).toEqual([]);
  });

  it("says whether abort() interrupted a run, and posts a decision with approve()", async () => {
    const fake = createFetchFake();
    fake.empty("POST", `/sessions/${SID}/abort`, 202);
    fake.empty("POST", `/sessions/${SID}/abort`, 204);
    fake.empty("POST", answerPath("call_9"), 204);
    const client = clientOf(fake);
    expect(await client.abort(SID)).toBe(true);
    expect(await client.abort(SID)).toBe(false);
    await client.approve(SID, "call_9", "allow");
    expect(fake.calls.at(-1)?.body).toEqual({ decision: "allow" });
  });

  it("parseArguments reads a call's arguments as an object, or null when they are not one", () => {
    expect(parseArguments({ arguments: '{"cmd":"ls"}' })).toEqual({ cmd: "ls" });
    expect(parseArguments({ arguments: "" })).toEqual({});
    expect(parseArguments({ arguments: '{"cmd":' })).toBeNull();
    expect(parseArguments({ arguments: "[1]" })).toBeNull();
  });
});
