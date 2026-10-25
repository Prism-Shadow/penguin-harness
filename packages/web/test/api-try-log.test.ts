/**
 * The API tab's Try it (features/agents/api-try-log.ts, api-try-transport.ts and
 * api-try-panel.tsx): a run sent through the try route and read by the SDK's client as the
 * records a program receives. The driver runs against the package's fetch fake, which serves SSE
 * bodies — whole, or held open and fed as the server would; the view renders to static markup and
 * its controls are driven through their handlers (node env, no DOM).
 *
 * The rendered view's rows:
 * - A message's `partial_*` fragments are one row, labelled by the complete record's type, that
 *   shows them joined while it streams; a tool call's fragments find its row by its id, and a
 *   child Session's start a row of their own.
 * - Once the complete record arrives the row shows its content in place of the fragments.
 * - Every other record is a row of its own, labelled by its `payload.type`, with its key fields;
 *   a record type the panel does not know shows what it carries.
 *
 * The panel:
 * - A run reads as numbered rows — the input, the call, its output, the answer — with no row for
 *   `ping`; the Session its session_meta names stays, the input clears, and the next run carries
 *   that session_id. The outcome strip shows the status, the Requests and the tokens.
 * - The raw view prints one `data:` line per record as received, `[DONE]` last.
 * - A refusal before the stream shows its status, code and message and no rows; a body that ends
 *   before `[DONE]` says the stream broke; a run whose last task_begin was never closed says it
 *   did not reach its end.
 * - An approval the SDK finds through the Session's approvals resource offers Allow and Deny on
 *   its tool call's row; Allow posts the decision and the buttons go.
 * - Stop once the run has named its Session posts the Session's abort; Stop before that aborts
 *   the request and says nothing went wrong.
 * - New conversation forgets the Session and the output and keeps the input.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AmspRecord, TokenCounts } from "@prismshadow/amsp";
import { ApprovalButtons } from "@prismshadow/penguin-ui";
import {
  addRecord,
  approvalDesk,
  initialTryState,
  rawLines,
  reduceTry,
  runTry,
  stopTry,
  tryBody,
} from "../src/features/agents/api-try-log";
import type { TryAction, TryRow, TryState } from "../src/features/agents/api-try-log";
import { ApiTryView } from "../src/features/agents/api-try-panel";
import type { ApiTryViewProps } from "../src/features/agents/api-try-panel";
import { S } from "../src/lib/strings";
import { apiError, json, stubFetch } from "./helpers/fetch";

const SESSION = "session-2026-10-09-09-30-00-7d2e41c8";
const TARGET = { projectId: "demo", agentId: "coder" };
const TRY_PATH = "/api/projects/demo/agents/coder/api/try";
const APPROVALS = `/api/sessions/${SESSION}/approvals`;
const usage = (output: number, total: number): TokenCounts => ({
  cache_read: 900,
  cache_write: 120,
  output,
  total,
});

let clock = Date.parse("2026-10-09T09:30:00.000Z");
const rec = (type: AmspRecord["type"], payload: object, origin?: string[]): AmspRecord =>
  ({
    timestamp: new Date((clock += 10)).toISOString(),
    type,
    payload,
    ...(origin ? { origin } : {}),
  }) as AmspRecord;
const ev = (payload: object, origin?: string[]) => rec("event_msg", payload, origin);
const msg = (payload: object, origin?: string[]) => rec("model_msg", payload, origin);
const partial = (type: string, eventType: string, fields: object, origin?: string[]) =>
  msg({ type, event_type: eventType, ...fields }, origin);
const call = (id: string, args: string) =>
  msg({ type: "tool_call", name: "exec_command", arguments: args, tool_call_id: id });

/** The new Session's session_meta: what names it on its first run's stream. */
const meta = () =>
  rec("session_meta", {
    session_id: SESSION,
    provider: "anthropic",
    model_id: "claude",
    model_context_window: 200000,
    source: "api",
  });

/** The example run: the model runs `date`, the tool answers, the model answers in fragments. */
function timeRun(): AmspRecord[] {
  return [
    meta(),
    ev({ type: "task_begin" }),
    msg({ type: "text", role: "user", text: "What time is it now?" }),
    ev({ type: "request_begin", thinking_level: "medium" }),
    partial("partial_tool_call", "start", {
      name: "exec_command",
      arguments: '{"cmd": ',
      tool_call_id: "call_1",
    }),
    partial("partial_tool_call", "delta", {
      name: "",
      arguments: '"date"}',
      tool_call_id: "call_1",
    }),
    call("call_1", '{"cmd":"date"}'),
    ev({ type: "approval_decision", decision: "allow", tool_call_id: "call_1" }),
    ev({ type: "token_usage", session: usage(31, 1376), request: usage(31, 1376) }),
    ev({ type: "request_end", status: "completed" }),
    msg({
      type: "tool_call_output",
      output: "Fri Oct  9 09:30:00 UTC 2026\n",
      tool_call_id: "call_1",
      status: "completed",
    }),
    ev({ type: "request_begin", thinking_level: "medium" }),
    partial("partial_text", "start", { role: "assistant", text: "" }),
    partial("partial_text", "delta", { role: "assistant", text: "It is " }),
    partial("partial_text", "delta", { role: "assistant", text: "09:30 UTC." }),
    msg({ type: "text", role: "assistant", text: "It is 09:30 UTC." }),
    ev({ type: "token_usage", session: usage(86, 2728), request: usage(55, 1352) }),
    ev({ type: "request_end", status: "completed" }),
    ev({ type: "task_end" }),
  ];
}

const PING = "event: ping\ndata: {}\n\n";
const frame = (r: AmspRecord, i: number) => `id: e-${i + 1}\ndata: ${JSON.stringify(r)}\n\n`;
const DONE = "data: [DONE]\n\n";

/** A whole run stream, as the try route sends it. */
function sse(records: AmspRecord[], done = true): Response {
  return new Response(PING + records.map(frame).join("") + (done ? DONE : ""), {
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  });
}

/** A body held open: the test sends the rest and closes it. */
function live(signal: AbortSignal | null) {
  const encoder = new TextEncoder();
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (stream = c) });
  signal?.addEventListener("abort", () => {
    try {
      stream.error(signal.reason);
    } catch {
      // Already closed.
    }
  });
  let n = 0;
  return {
    response: new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8" },
    }),
    send(text: string) {
      stream.enqueue(encoder.encode(text));
    },
    record(r: AmspRecord) {
      stream.enqueue(encoder.encode(frame(r, n++)));
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
    rows: state.rows,
    lines: rawLines(state),
    view: state.view,
    result: state.result,
    error: state.error,
    broken: state.broken,
    disabled: false,
    onInput: noop,
    onRun: noop,
    onStop: noop,
    onNewSession: noop,
    onView: noop,
    onApprove: async () => {},
    ...over,
  };
}
const html = (state: TryState, over: Partial<ApiTryViewProps> = {}) =>
  renderToStaticMarkup(createElement(ApiTryView, viewProps(state, over)));

const ENTITIES: Record<string, string> = {
  "&quot;": '"',
  "&#x27;": "'",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
};
const decode = (markup: string) =>
  markup.replace(/&(?:quot|#x27|amp|lt|gt);/g, (e) => ENTITIES[e]!);
const tagged = (markup: string, testid: string) =>
  [...markup.matchAll(new RegExp(`<li data-testid="${testid}"[^>]*>([\\s\\S]*?)</li>`, "g"))].map(
    (m) => decode(m[1]!),
  );
const words = (inner: string) =>
  inner
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
/** The rendered view's rows as a reader sees them: the number, the label, the content. */
const rowsShown = (state: TryState) => tagged(html(state), "api-try-row").map(words);

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

const rowsOf = (records: AmspRecord[]): TryRow[] =>
  records.reduce<TryRow[]>((rows, r) => addRecord(rows, r), []);

describe("the rendered view's rows", () => {
  it("merges a message's fragments into one row, by its tool call and its Session", () => {
    const rows = rowsOf([
      partial("partial_text", "start", { role: "assistant", text: "Hel" }),
      partial("partial_text", "delta", { role: "assistant", text: "lo" }),
      partial("partial_tool_call", "start", {
        name: "exec_command",
        arguments: '{"cmd":',
        tool_call_id: "c1",
      }),
      partial("partial_tool_call", "start", {
        name: "read_file",
        arguments: "{}",
        tool_call_id: "c2",
      }),
      partial("partial_tool_call", "delta", { name: "", arguments: '"ls"}', tool_call_id: "c1" }),
      partial("partial_text", "start", { role: "assistant", text: "child" }, ["sub-1"]),
    ]);
    expect(rows).toMatchObject([
      { kind: "item", label: "text", text: "Hello", open: true },
      { kind: "item", label: "tool_call", name: "exec_command", text: '{"cmd":"ls"}', open: true },
      { kind: "item", label: "tool_call", name: "read_file", text: "{}", open: true },
      { kind: "item", label: "text", text: "child", origin: "sub-1", open: true },
    ]);
  });

  it("shows the complete record's content in place of the fragments, whatever they said", () => {
    const rows = rowsOf([
      partial("partial_text", "delta", { role: "assistant", text: "It's 9:30" }),
      msg({ type: "text", role: "assistant", text: "It is 09:30 UTC." }),
    ]);
    expect(rows).toMatchObject([{ label: "text", text: "It is 09:30 UTC.", open: false }]);
  });

  it("gives every other record a row labelled by its type, an unknown one showing what it carries", () => {
    const rows = rowsOf([
      ev({ type: "task_begin" }),
      ev({ type: "request_end", status: "fatal", error_code: "auth", error_message: "bad key" }),
      ev({ type: "something_new", value: 7 }),
    ]);
    expect(rows.map((r) => r.label)).toEqual(["task_begin", "request_end", "something_new"]);
    expect(rows[1]).toMatchObject({
      fields: [{ value: "fatal" }, { value: "auth" }, { value: "bad key" }],
    });
    expect(rows[2]).toMatchObject({ fields: [{ value: '{"value":7}' }] });
  });
});

describe("the panel", () => {
  it("reads a run as numbered rows without ping, keeps the Session, and continues it", async () => {
    const fetch = stubFetch(() => sse(timeRun()));
    const h = harness();
    await runTry(TARGET, h.dispatch, tryBody(h.state), new AbortController().signal);
    expect(fetch.requests[0]).toMatchObject({ method: "POST", path: TRY_PATH });
    expect(fetch.requests[0]!.body).toEqual({ input: S.agent.apiTryExample });
    const shown = rowsShown(h.state);
    expect(shown[0]).toMatch(/^1 session_meta anthropic\/claude/);
    expect(shown.map((r) => r.split(" ")[1])).toEqual([
      "session_meta",
      "task_begin",
      "text",
      "request_begin",
      "tool_call",
      "approval_decision",
      "token_usage",
      "request_end",
      "tool_call_output",
      "request_begin",
      "text",
      "token_usage",
      "request_end",
      "task_end",
    ]);
    expect(shown[10]).toBe("11 text It is 09:30 UTC.");
    expect(h.state.sessionId).toBe(SESSION);
    expect(h.state.input).toBe("");
    const strip = words(html(h.state).split('data-slot="foot"')[1]!);
    expect(strip).toContain("completed");
    expect(strip).toContain("86 / 2728");

    h.dispatch({ type: "input", text: "And now?" });
    fetch.answer(() => sse([ev({ type: "task_begin" }), ev({ type: "task_end" })]));
    await runTry(TARGET, h.dispatch, tryBody(h.state), new AbortController().signal);
    expect(fetch.requests.at(-1)!.body).toEqual({ input: "And now?", session_id: SESSION });
  });

  it("prints one data line per record in the raw view, [DONE] last", async () => {
    const records = [meta(), ev({ type: "task_begin" }), ev({ type: "task_end" })];
    stubFetch(() => sse(records));
    const h = harness();
    await runTry(TARGET, h.dispatch, tryBody(h.state), new AbortController().signal);
    expect(rawLines(h.state)).toEqual([
      ...records.map((r) => `data: ${JSON.stringify(r)}`),
      "data: [DONE]",
    ]);
  });

  it("shows a refusal, a broken stream and an unfinished run in the outcome strip", async () => {
    stubFetch(() => apiError(409, "task_in_progress", "Busy."));
    const refused = harness();
    await runTry(TARGET, refused.dispatch, tryBody(refused.state), new AbortController().signal);
    expect(refused.state.rows).toEqual([]);
    expect(html(refused.state)).toContain("409 task_in_progress — Busy.");

    stubFetch(() => sse([ev({ type: "task_begin" })], false));
    const broken = harness();
    await runTry(TARGET, broken.dispatch, tryBody(broken.state), new AbortController().signal);
    expect(html(broken.state)).toContain(S.agent.apiTryStreamBroken);

    stubFetch(() => sse([meta(), ev({ type: "task_begin" })]));
    const unfinished = harness();
    await runTry(
      TARGET,
      unfinished.dispatch,
      tryBody(unfinished.state),
      new AbortController().signal,
    );
    expect(html(unfinished.state)).toContain(S.agent.apiTryUnfinished);
  });

  it("offers Allow and Deny on the call the approvals resource returns, and posts the answer", async () => {
    let body!: ReturnType<typeof live>;
    let answered: unknown;
    stubFetch((req) => {
      if (req.path === TRY_PATH) {
        body = live(req.signal);
        body.send(PING);
        body.record(meta());
        body.record(ev({ type: "task_begin" }));
        body.record(call("call_9", '{"cmd":"rm -rf build"}'));
        return body.response;
      }
      if (req.path === APPROVALS) {
        return json({
          approvals: [{ tool_call: call("call_9", '{"cmd":"rm -rf build"}').payload }],
        });
      }
      if (req.path === `${APPROVALS}/call_9`) {
        answered = req.body;
        body.record(ev({ type: "approval_decision", decision: "allow", tool_call_id: "call_9" }));
        body.record(ev({ type: "task_end" }));
        body.send(DONE);
        body.close();
        return new Response(null, { status: 204 });
      }
      return apiError(404, "not_found");
    });
    const h = harness();
    const desk = approvalDesk(h.dispatch);
    const running = runTry(
      TARGET,
      h.dispatch,
      tryBody(h.state),
      new AbortController().signal,
      desk,
    );
    await vi.waitFor(() => {
      expect(find(ApiTryView(viewProps(h.state)), ApprovalButtons)).toHaveLength(1);
    });
    const [buttons] = find(
      ApiTryView(viewProps(h.state, { onApprove: async (id, d) => void desk.answer(id, d) })),
      ApprovalButtons,
    );
    await (buttons!.props.onDecide as (d: "allow" | "deny") => Promise<void>)("allow");
    await running;
    expect(answered).toEqual({ decision: "allow" });
    expect(find(ApiTryView(viewProps(h.state)), ApprovalButtons)).toHaveLength(0);
    expect(h.state.result?.run.status).toBe("completed");
  });

  it("stops through the Session's abort once it has one, and by closing the request before", async () => {
    const fetch = stubFetch(() => new Response(null, { status: 202 }));
    const named = harness();
    named.dispatch({ type: "start" });
    named.dispatch({ type: "session", sessionId: SESSION, atMs: 0 });
    await stopTry(named.state, null);
    expect(fetch.requests.at(-1)).toMatchObject({
      method: "POST",
      path: `/api/sessions/${SESSION}/abort`,
    });

    stubFetch((req) => live(req.signal).response);
    const early = harness();
    const controller = new AbortController();
    const running = runTry(TARGET, early.dispatch, tryBody(early.state), controller.signal);
    await stopTry(early.state, controller);
    await running;
    expect(early.state.running).toBe(false);
    expect(early.state.broken).toBe(false);
    expect(early.state.error).toBeNull();
  });

  it("forgets the Session and the output on New conversation, keeping the input", async () => {
    stubFetch(() => sse(timeRun()));
    const h = harness();
    await runTry(TARGET, h.dispatch, tryBody(h.state), new AbortController().signal);
    h.dispatch({ type: "input", text: "Next" });
    h.dispatch({ type: "reset" });
    expect(h.state).toMatchObject({ sessionId: null, rows: [], lines: [], input: "Next" });
  });
});
