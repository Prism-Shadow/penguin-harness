/**
 * The API tab's Try it (features/agents/api-try-log.ts and api-try-panel.tsx): a run sent
 * through the try route and read back as the AMSP stream a program receives. The driver runs
 * against the package's fetch fake, which serves scripted SSE bodies — whole, or held open and
 * fed as the server would (the abort and approvals routes feed the rest); the view renders to
 * static markup and its controls are driven through their handlers (node env, no DOM).
 *
 * - Consecutive fragments of one item fold into one entry that counts them and keeps every raw
 *   payload, a run of text fragments showing its accumulated length; fragments of another tool
 *   call or another origin start a new entry, and every other event is one entry.
 * - Each event's line names its key fields: the Session of run.started, the tool and arguments
 *   of tool_call.done, the status and first line of tool_result.done, the tool an approval asks
 *   about, the status, Request count and total of run.done; long values are cut.
 * - A run against the fake yields the entries, the answer, the result line's values and the
 *   Session id; the input clears to the follow-up placeholder, and the next run carries that
 *   session_id.
 * - The raw view prints the exact data: lines as received, [DONE] last.
 * - A refusal before the stream shows its status, code and message and no entries; a body that
 *   ends before run.done shows the broken-stream line after the entries.
 * - Stop once the run has named its Session posts the Session's abort, and the stream's own
 *   run.done aborted is logged; Stop before run.started aborts the request and says nothing
 *   went wrong.
 * - An approval.requested line offers Allow and Deny; an answer posts the decision to the
 *   Session's approvals route and its buttons go; an approval.decided from elsewhere, or the
 *   run's end, clears them too.
 * - New conversation forgets the Session and the output and keeps the input.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AmspEvent, TokenCounts } from "@prismshadow/amsp";
import { Button } from "@prismshadow/penguin-ui";
import {
  answerApproval,
  appendEvent,
  initialTryState,
  reduceTry,
  runTry,
  stopTry,
  summarizeEvent,
  tryBody,
} from "../src/features/agents/api-try-log";
import type { TryAction, TryEntry, TryState } from "../src/features/agents/api-try-log";
import { ApiTryView } from "../src/features/agents/api-try-panel";
import type { ApiTryViewProps } from "../src/features/agents/api-try-panel";
import { S } from "../src/lib/strings";
import { apiError, stubFetch } from "./helpers/fetch";

const SESSION = "session-2026-10-09-09-30-00-7d2e41c8";
const TARGET = { projectId: "demo", agentId: "coder" };
const TRY_PATH = "/api/projects/demo/agents/coder/api/try";
const T0 = Date.parse("2026-10-09T09:30:00.000Z");
const at = (ms: number) => new Date(T0 + ms).toISOString();
const usage = (output: number, total: number): TokenCounts => ({
  cache_read: 900,
  cache_write: 120,
  output,
  total,
});

const STARTED: AmspEvent = {
  type: "run.started",
  at: at(0),
  session_id: SESSION,
  agent: "demo/coder",
};

/** The example run: the model runs `date`, reads it, and answers, over two Requests. */
const TIME_RUN: AmspEvent[] = [
  STARTED,
  { type: "request.started", at: at(20), request: 1 },
  {
    type: "tool_call.delta",
    at: at(500),
    tool_call_id: "call_1",
    name: "exec_command",
    arguments: "",
  },
  {
    type: "tool_call.delta",
    at: at(510),
    tool_call_id: "call_1",
    name: "",
    arguments: '{"cmd": "date"}',
  },
  {
    type: "tool_call.done",
    at: at(520),
    tool_call_id: "call_1",
    name: "exec_command",
    arguments: '{"cmd":"date"}',
    stop_reason: "completed",
  },
  {
    type: "tool_result.done",
    at: at(700),
    tool_call_id: "call_1",
    output: "Fri Oct  9 09:30:00 UTC 2026\n",
    stop_reason: "completed",
  },
  { type: "request.done", at: at(710), request: 1, status: "completed", usage: usage(31, 1376) },
  { type: "request.started", at: at(720), request: 2 },
  { type: "text.delta", at: at(1500), role: "assistant", text: "It is " },
  { type: "text.delta", at: at(1510), role: "assistant", text: "09:30 UTC." },
  {
    type: "text.done",
    at: at(1520),
    role: "assistant",
    text: "It is 09:30 UTC.",
    stop_reason: "completed",
  },
  { type: "request.done", at: at(1530), request: 2, status: "completed", usage: usage(55, 1352) },
  {
    type: "run.done",
    at: at(3200),
    status: "completed",
    requests: 2,
    usage: usage(86, 2728),
    session_usage: usage(86, 2728),
  },
];

const encoder = new TextEncoder();
const block = (data: string) => `data: ${data}\n\n`;
const payloadOf = (e: AmspEvent | "[DONE]") => (e === "[DONE]" ? e : JSON.stringify(e));

/** A whole SSE body, as the try route sends it. */
function sse(events: Array<AmspEvent | "[DONE]">): Response {
  return new Response(events.map((e) => block(payloadOf(e))).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  });
}

/** A body held open: the test (or another route of the fake) sends the rest and closes it. */
function live(signal: AbortSignal | null) {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (stream = c) });
  // Like a real fetch: aborting the request errors its body.
  signal?.addEventListener("abort", () => {
    try {
      stream.error(signal.reason);
    } catch {
      // Already closed.
    }
  });
  return {
    response: new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8" },
    }),
    send(...events: Array<AmspEvent | "[DONE]">) {
      for (const e of events) stream.enqueue(encoder.encode(block(payloadOf(e))));
    },
    close() {
      stream.close();
    },
  };
}

/** The panel's state, driven by the reducer the panel uses. */
function harness(state: TryState = initialTryState(S.agent.apiTryExample)) {
  const h = {
    state,
    dispatch: (action: TryAction) => {
      h.state = reduceTry(h.state, action);
    },
  };
  return h;
}

const noop = () => {};
function viewProps(state: TryState, over: Partial<ApiTryViewProps> = {}): ApiTryViewProps {
  return {
    input: state.input,
    running: state.running,
    sessionId: state.sessionId,
    entries: state.entries,
    view: state.view,
    result: state.result,
    error: state.error,
    broken: state.broken,
    closed: state.closed,
    disabled: false,
    onInput: noop,
    onRun: noop,
    onStop: noop,
    onNewSession: noop,
    onView: noop,
    onApprove: noop,
    ...over,
  };
}
const html = (state: TryState, over: Partial<ApiTryViewProps> = {}) =>
  renderToStaticMarkup(createElement(ApiTryView, viewProps(state, over)));

/** Every element of `type` in a tree of plain elements, its children followed. */
function find(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>>[] {
  return ([] as ReactNode[])
    .concat(node)
    .filter(isValidElement)
    .flatMap((el) => {
      const element = el as ReactElement<{ children?: ReactNode }>;
      const own = element.type === type ? [element as ReactElement<Record<string, unknown>>] : [];
      return [...own, ...find(element.props.children, type)];
    });
}
const buttonsNamed = (state: TryState, name: string, over: Partial<ApiTryViewProps> = {}) =>
  find(ApiTryView(viewProps(state, over)), Button).filter((b) => b.props.children === name);

/** The log after these events, each sent as its payload. */
const logOf = (events: AmspEvent[]): TryEntry[] =>
  events.reduce<TryEntry[]>((entries, e) => appendEvent(entries, JSON.stringify(e)), []);

describe("the Try log", () => {
  it("folds consecutive fragments of one item into one counted entry, keeping every payload", () => {
    const text = (t: string, origin?: string[]): AmspEvent => ({
      type: "text.delta",
      at: at(0),
      role: "assistant",
      text: t,
      ...(origin ? { origin } : {}),
    });
    const call = (id: string, args: string): AmspEvent => ({
      type: "tool_call.delta",
      at: at(0),
      tool_call_id: id,
      name: "",
      arguments: args,
    });
    const done: AmspEvent = {
      type: "text.done",
      at: at(0),
      role: "assistant",
      text: "Hello world",
      stop_reason: "completed",
    };
    const events = [
      text("Hel"),
      text("lo wo"),
      text("rld"),
      call("call_1", '{"cmd":'),
      call("call_1", '"ls"}'),
      call("call_2", "{}"),
      text("child", ["sub-1"]),
      done,
      done,
    ];
    const entries = logOf(events);
    expect(entries.map((e) => [e.type, e.count])).toEqual([
      ["text.delta", 3],
      ["tool_call.delta", 2],
      ["tool_call.delta", 1],
      ["text.delta", 1],
      ["text.done", 1],
      ["text.done", 1],
    ]);
    expect(entries[0]!.summary).toContain("11");
    expect(entries[0]!.raw).toEqual(events.slice(0, 3).map((e) => JSON.stringify(e)));
    expect(entries.flatMap((e) => e.raw)).toEqual(events.map((e) => JSON.stringify(e)));
  });

  it("keeps a payload that is not an AMSP event as its own line", () => {
    const entries = appendEvent([], "not json");
    expect(entries).toMatchObject([{ type: "?", summary: "not json", raw: ["not json"] }]);
  });

  it.each<[string, AmspEvent, string[], string[]]>([
    ["run.started", STARTED, [SESSION], []],
    [
      "context.opened",
      {
        type: "context.opened",
        at: at(0),
        session_id: SESSION,
        provider: "anthropic",
        model_id: "claude-sonnet-5",
        context_window: 200000,
      },
      ["anthropic/claude-sonnet-5"],
      [],
    ],
    ["request.started", { type: "request.started", at: at(0), request: 2 }, ["2"], []],
    [
      "request.done with usage",
      { type: "request.done", at: at(0), request: 1, status: "completed", usage: usage(5, 77) },
      ["completed", "77"],
      [],
    ],
    [
      "request.done without usage",
      { type: "request.done", at: at(0), request: 1, status: "aborted", usage: null },
      ["aborted"],
      ["total"],
    ],
    ["tool_call.done", TIME_RUN[4]!, ["exec_command", '{"cmd":"date"}'], []],
    [
      "tool_result.done",
      {
        type: "tool_result.done",
        at: at(0),
        tool_call_id: "call_1",
        output: "\nfirst line\nsecond line",
        stop_reason: "completed",
      },
      ["completed", "first line"],
      ["second line"],
    ],
    [
      "a long text.done",
      {
        type: "text.done",
        at: at(0),
        role: "assistant",
        text: `${"a".repeat(200)} tail`,
        stop_reason: "completed",
      },
      ["a".repeat(120)],
      ["tail"],
    ],
    [
      "thinking.done",
      { type: "thinking.done", at: at(0), thinking: "x".repeat(42), stop_reason: "completed" },
      ["42"],
      ["xxx"],
    ],
    [
      "approval.requested",
      {
        type: "approval.requested",
        at: at(0),
        tool_call: { tool_call_id: "call_1", name: "exec_command", arguments: "{}" },
      },
      ["exec_command"],
      [],
    ],
    [
      "approval.decided",
      { type: "approval.decided", at: at(0), tool_call_id: "call_1", decision: "deny" },
      ["deny"],
      [],
    ],
    [
      "compaction.started",
      {
        type: "compaction.started",
        at: at(0),
        reason: "context",
        mode: "summarize",
        context: 300,
        turns: 1,
      },
      ["context"],
      [],
    ],
    [
      "run.done with an error",
      {
        type: "run.done",
        at: at(0),
        status: "aborted",
        error: { code: "user_abort", message: "Aborted." },
        requests: 2,
        usage: usage(9, 314),
        session_usage: null,
      },
      ["aborted", "requests=2", "total=314", "user_abort"],
      [],
    ],
    [
      "any other event",
      { type: "tools.ready", at: at(0), tools: [{ name: "exec_command", description: "Run." }] },
      ["exec_command"],
      ["tools.ready", at(0)],
    ],
  ])("the line of %s names its key fields", (_name, event, shows, hides) => {
    const line = summarizeEvent(event);
    for (const s of shows) expect(line).toContain(s);
    for (const s of hides) expect(line).not.toContain(s);
  });
});

describe("a Try run", () => {
  it("yields the entries, the answer, the result and the Session; the next run continues it", async () => {
    const fetch = stubFetch(() => sse([...TIME_RUN, "[DONE]"]));
    const h = harness();
    await runTry(TARGET, h.dispatch, tryBody(h.state), new AbortController().signal);

    expect(fetch.requests.map((r) => [r.method, r.path, r.body])).toEqual([
      ["POST", TRY_PATH, { input: S.agent.apiTryExample }],
    ]);
    expect(h.state.entries.map((e) => (e.count > 1 ? `${e.type} ×${e.count}` : e.type))).toEqual([
      "run.started",
      "request.started",
      "tool_call.delta ×2",
      "tool_call.done",
      "tool_result.done",
      "request.done",
      "request.started",
      "text.delta ×2",
      "text.done",
      "request.done",
      "run.done",
    ]);
    expect(h.state).toMatchObject({ running: false, sessionId: SESSION, broken: false });
    expect(h.state.result).toMatchObject({
      run: { status: "completed", requests: 2, text: "It is 09:30 UTC.", usage: usage(86, 2728) },
      elapsedMs: 3200,
    });
    const view = html(h.state);
    expect(view).toContain(SESSION);
    expect(view).toContain("It is 09:30 UTC.");
    expect(view).toContain("86 / 2728");
    expect(view).toContain("3.2 s");
    // Finished: the input is cleared for a follow-up on the same Session.
    expect(h.state.input).toBe("");
    expect(view).toContain(`placeholder="${S.agent.apiTryFollowUp}"`);

    fetch.answer(() => sse([STARTED, TIME_RUN.at(-1)!, "[DONE]"]));
    h.dispatch({ type: "input", text: "And in Tokyo?" });
    await runTry(TARGET, h.dispatch, tryBody(h.state), new AbortController().signal);
    expect(fetch.requests[1]!.body).toEqual({ input: "And in Tokyo?", session_id: SESSION });
    // A new run's log starts empty.
    expect(h.state.entries.map((e) => e.type)).toEqual(["run.started", "run.done"]);
  });

  it("shows the exact data: lines in the raw view, [DONE] last", async () => {
    stubFetch(() => sse([...TIME_RUN, "[DONE]"]));
    const h = harness();
    await runTry(TARGET, h.dispatch, tryBody(h.state), new AbortController().signal);
    const [pre] = find(ApiTryView(viewProps(h.state, { view: "raw" })), "pre");
    expect(pre!.props.children).toBe(
      [...TIME_RUN.map((e) => `data: ${JSON.stringify(e)}`), "data: [DONE]"].join("\n"),
    );
    expect(find(ApiTryView(viewProps(h.state)), "pre")).toEqual([]);
  });

  it("shows a refusal before the stream as its status, code and message, with no entries", async () => {
    stubFetch(() => apiError(409, "task_in_progress", "The Session is busy."));
    const h = harness();
    await runTry(TARGET, h.dispatch, tryBody(h.state), new AbortController().signal);
    expect(h.state).toMatchObject({ running: false, entries: [], broken: false });
    const view = html(h.state);
    expect(view).toContain("409 task_in_progress — The Session is busy.");
    expect(view).not.toContain('data-testid="api-try-event"');
    expect(view).not.toContain(S.agent.apiTryStreamBroken);
  });

  it("says the stream broke when the body ends before run.done, after the entries so far", async () => {
    stubFetch(() => sse(TIME_RUN.slice(0, 3)));
    const h = harness();
    await runTry(TARGET, h.dispatch, tryBody(h.state), new AbortController().signal);
    expect(h.state).toMatchObject({ running: false, broken: true, result: null });
    expect(h.state.entries).toHaveLength(3);
    const view = html(h.state);
    expect(view.indexOf(S.agent.apiTryStreamBroken)).toBeGreaterThan(
      view.lastIndexOf('data-testid="api-try-event"'),
    );
    // The Session it named is kept: the next run can continue it.
    expect(tryBody(h.state)).toMatchObject({ session_id: SESSION });
  });

  it("stops a run that named its Session through the Session's abort route, and logs the stream's run.done aborted", async () => {
    let body: ReturnType<typeof live> | null = null;
    const fetch = stubFetch((req) => {
      if (req.path === TRY_PATH) {
        body = live(req.signal);
        body.send(STARTED, TIME_RUN[1]!, TIME_RUN[8]!);
        return body.response;
      }
      if (req.path === `/api/sessions/${SESSION}/abort`) {
        // The server aborts the run; its stream ends as it always does.
        body!.send(
          { type: "request.done", at: at(900), request: 2, status: "aborted", usage: null },
          {
            type: "run.done",
            at: at(950),
            status: "aborted",
            error: { code: "user_abort", message: "Aborted by the user." },
            requests: 2,
            usage: usage(31, 1376),
            session_usage: null,
          },
          "[DONE]",
        );
        body!.close();
        return new Response(null, { status: 202 });
      }
      return apiError(404, "not_found");
    });
    const h = harness();
    const connection = new AbortController();
    const running = runTry(TARGET, h.dispatch, tryBody(h.state), connection.signal);
    await vi.waitFor(() => expect(h.state.entries).toHaveLength(3));
    expect(h.state.running).toBe(true);

    await stopTry(h.state, connection);
    await running;
    expect(fetch.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      `POST ${TRY_PATH}`,
      `POST /api/sessions/${SESSION}/abort`,
    ]);
    expect(connection.signal.aborted).toBe(false);
    expect(h.state.entries.at(-1)).toMatchObject({ type: "run.done" });
    expect(h.state.entries.at(-1)!.summary).toContain("aborted");
    expect(h.state).toMatchObject({ running: false, broken: false, closed: true });
    expect(h.state.result?.run.status).toBe("aborted");
  });

  it("stops a run that has not named its Session yet by aborting the request, with no error line", async () => {
    const fetch = stubFetch(
      (req) =>
        new Promise<Response>((_resolve, reject) =>
          req.signal?.addEventListener("abort", () => reject(req.signal!.reason)),
        ),
    );
    // A continued conversation: the Session is known, but this run has not started on it.
    const h = harness({ ...initialTryState("And now?"), sessionId: SESSION });
    const connection = new AbortController();
    const running = runTry(TARGET, h.dispatch, tryBody(h.state), connection.signal);
    await vi.waitFor(() => expect(fetch.requests).toHaveLength(1));

    await stopTry(h.state, connection);
    await running;
    expect(fetch.requests[0]!.signal?.aborted).toBe(true);
    expect(fetch.requests).toHaveLength(1);
    expect(h.state).toMatchObject({ running: false, broken: false, error: null, entries: [] });
    expect(html(h.state)).not.toContain(S.agent.apiTryStreamBroken);
  });

  it("offers Allow and Deny on an approval line; an answer posts the decision and its buttons go", async () => {
    let body: ReturnType<typeof live> | null = null;
    const asked: AmspEvent = {
      type: "approval.requested",
      at: at(530),
      tool_call: { tool_call_id: "call_1", name: "exec_command", arguments: '{"cmd":"date"}' },
    };
    const fetch = stubFetch((req) => {
      if (req.path === TRY_PATH) {
        body = live(req.signal);
        body.send(STARTED, TIME_RUN[1]!, TIME_RUN[4]!, asked);
        return body.response;
      }
      if (req.path === `/api/sessions/${SESSION}/approvals/call_1`) {
        body!.send(
          { type: "approval.decided", at: at(600), tool_call_id: "call_1", decision: "allow" },
          ...TIME_RUN.slice(5),
          "[DONE]",
        );
        body!.close();
        return new Response(null, { status: 204 });
      }
      return apiError(404, "not_found");
    });
    const h = harness();
    const running = runTry(TARGET, h.dispatch, tryBody(h.state), new AbortController().signal);
    await vi.waitFor(() => expect(h.state.entries.at(-1)?.type).toBe("approval.requested"));

    const onApprove = vi.fn();
    const [allow] = buttonsNamed(h.state, S.chat.approve, { onApprove });
    expect(buttonsNamed(h.state, S.chat.deny)).toHaveLength(1);
    (allow!.props.onClick as () => void)();
    expect(onApprove).toHaveBeenCalledExactlyOnceWith("call_1", "allow");

    await answerApproval(SESSION, "call_1", "allow", h.dispatch);
    expect(fetch.requests.at(-1)).toMatchObject({
      method: "POST",
      path: `/api/sessions/${SESSION}/approvals/call_1`,
      body: { decision: "allow" },
    });
    expect(buttonsNamed(h.state, S.chat.approve)).toEqual([]);
    await running;
    expect(h.state.entries.map((e) => e.type)).toContain("approval.decided");
    expect(h.state.result?.run.status).toBe("completed");
  });

  it("clears an approval's buttons when it was decided elsewhere, or when the run ended", () => {
    const asked: AmspEvent = {
      type: "approval.requested",
      at: at(1),
      tool_call: { tool_call_id: "call_1", name: "exec_command", arguments: "{}" },
    };
    const h = harness();
    h.dispatch({ type: "start" });
    for (const e of [STARTED, asked]) h.dispatch({ type: "payload", data: JSON.stringify(e) });
    expect(buttonsNamed(h.state, S.chat.approve)).toHaveLength(1);
    const decided = reduceTry(h.state, {
      type: "payload",
      data: JSON.stringify({
        type: "approval.decided",
        at: at(2),
        tool_call_id: "call_1",
        decision: "deny",
      }),
    });
    expect(buttonsNamed(decided, S.chat.approve)).toEqual([]);
    const ended = reduceTry(h.state, { type: "ended" });
    expect(buttonsNamed(ended, S.chat.approve)).toEqual([]);
  });

  it("forgets the Session and the output on New conversation, keeping the input", async () => {
    stubFetch(() => sse([...TIME_RUN, "[DONE]"]));
    const h = harness();
    await runTry(TARGET, h.dispatch, tryBody(h.state), new AbortController().signal);
    h.dispatch({ type: "input", text: "Again from the start" });

    const onNewSession = vi.fn();
    const [fresh] = buttonsNamed(h.state, S.agent.apiTryNewSession, { onNewSession });
    (fresh!.props.onClick as () => void)();
    expect(onNewSession).toHaveBeenCalledOnce();

    h.dispatch({ type: "reset" });
    expect(h.state).toMatchObject({
      input: "Again from the start",
      sessionId: null,
      entries: [],
      result: null,
    });
    expect(tryBody(h.state)).toEqual({ input: "Again from the start" });
    expect(html(h.state)).not.toContain(SESSION);
  });
});
