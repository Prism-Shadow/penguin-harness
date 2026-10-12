/**
 * The API tab's Try it (features/agents/api-try-log.ts and api-try-panel.tsx): a run sent
 * through the try route and read back as the AMSP stream a program receives. The driver runs
 * against the package's fetch fake, which serves scripted SSE bodies — whole, or held open and
 * fed as the server would (the abort and approvals routes feed the rest); the view renders to
 * static markup and its controls are driven through their handlers (node env, no DOM).
 *
 * The rendered view's rows:
 * - An item's fragments are one row showing them joined while the item streams; fragments of
 *   another tool call or another Session start a row of their own.
 * - Once the item's .done arrives the row shows the .done's content in place of the joined
 *   fragments, whatever the fragments said.
 * - Tool results that interleave stay on their own rows, found by their tool call.
 * - A streamed summary, which has no .done, is its fragments joined; its compaction's end
 *   completes it.
 * - Rows are numbered in the order they first appear, and a merged row keeps its number when
 *   its .done arrives after later rows.
 * - A payload that is not an AMSP event is a row of its own; every other event is one row
 *   naming its key fields (tools.ready its tool count and names, not their JSON).
 *
 * The panel:
 * - A run against the fake reads as numbered rows — the answer as its text row, the call's
 *   arguments indented — with the Session id; the input clears to the follow-up placeholder,
 *   and the next run carries that session_id.
 * - A row still streaming carries the live caret while the run lasts; a complete one does not.
 *   Arguments that do not parse yet show as received.
 * - Inline media shows its type and size, never its bytes; fragments of one add up.
 * - A row says what sets its item apart: a text the harness sent, a call cut short, a result's
 *   images; a child Session's rows carry the chain they came from.
 * - The outcome strip shows the cache-read and cache-write token counts, each only when it is
 *   not zero.
 * - The raw view prints one numbered line per payload exactly as received, [DONE] last, and its
 *   copy button copies exactly those lines.
 * - A refusal before the stream shows its status, code and message in the outcome strip and no
 *   rows; a body that ends before run.done keeps its rows and says the stream broke.
 * - Stop once the run has named its Session posts the Session's abort, and the stream's own
 *   run.done aborted is shown; Stop before run.started aborts the request, says nothing went
 *   wrong, and leaves the box as it was before any run.
 * - An approval.requested row offers Allow and Deny; an answer posts the decision to the
 *   Session's approvals route and its buttons go; an approval.decided from elsewhere, or the
 *   run's end, clears them too.
 * - New conversation forgets the Session and the output and keeps the input.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AmspEvent, TokenCounts } from "@prismshadow/amsp";
import { ApprovalButtons, Button, CopyButton } from "@prismshadow/penguin-ui";
import {
  addPayload,
  answerApproval,
  eventFields,
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
const text = (t: string, origin?: string[]): AmspEvent => ({
  type: "text.delta",
  at: at(0),
  role: "assistant",
  text: t,
  ...(origin ? { origin } : {}),
});
const callFragment = (id: string, name: string, args: string): AmspEvent => ({
  type: "tool_call.delta",
  at: at(0),
  tool_call_id: id,
  name,
  arguments: args,
});
const output = (id: string, out: string): AmspEvent => ({
  type: "tool_result.delta",
  at: at(0),
  tool_call_id: id,
  output: out,
});

/**
 * The example run as the server streams it: the model runs `date` and answers, over two
 * Requests, fragments first; the tool's result ends after its Request does.
 */
const TIME_RUN: AmspEvent[] = [
  STARTED,
  {
    type: "tools.ready",
    at: at(10),
    tools: [
      { name: "exec_command", description: "Run a command." },
      { name: "read_file", description: "Read a file." },
    ],
  },
  { type: "request.started", at: at(20), request: 1 },
  { ...callFragment("call_1", "exec_command", '{"cmd": '), at: at(500) },
  { ...callFragment("call_1", "", '"date"}'), at: at(510) },
  {
    type: "tool_call.done",
    at: at(520),
    tool_call_id: "call_1",
    name: "exec_command",
    arguments: '{"cmd":"date"}',
    stop_reason: "completed",
  },
  { ...output("call_1", ""), at: at(530) },
  { type: "request.done", at: at(540), request: 1, status: "completed", usage: usage(31, 1376) },
  {
    type: "tool_result.done",
    at: at(700),
    tool_call_id: "call_1",
    output: "Fri Oct  9 09:30:00 UTC 2026\n",
    stop_reason: "completed",
  },
  { type: "request.started", at: at(720), request: 2 },
  { ...text("It is "), at: at(1500) },
  { ...text("09:30 UTC."), at: at(1510) },
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
const RUN_DONE = TIME_RUN.at(-1) as Extract<AmspEvent, { type: "run.done" }>;

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

/** A run under way: started, and these events received. */
function streaming(events: AmspEvent[]): TryState {
  const h = harness();
  h.dispatch({ type: "start" });
  for (const e of events) h.dispatch({ type: "payload", data: JSON.stringify(e) });
  return h.state;
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
/** The inner markup of every element tagged `testid`, entities decoded. */
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
const rowsShown = (state: TryState, over: Partial<ApiTryViewProps> = {}) =>
  tagged(html(state, over), "api-try-row").map(words);
/** The raw view's lines as a reader sees them: the number, then the line, spaces kept. */
const rawShown = (state: TryState) =>
  tagged(html(state, { view: "raw" }), "api-try-raw-line").map((inner) =>
    inner
      .split(/<[^>]+>/)
      .filter((cell) => cell !== "")
      .join(" "),
  );

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
/** The Allow / Deny pairs on screen, each answering through `onDecide`. */
const approvalsOn = (state: TryState, over: Partial<ApiTryViewProps> = {}) =>
  find(ApiTryView(viewProps(state, over)), ApprovalButtons).map(
    (b) => b.props.onDecide as (decision: "allow" | "deny") => Promise<void>,
  );

/** The rows after these events, each sent as its payload. */
const rowsOf = (events: AmspEvent[]): TryRow[] =>
  events.reduce<TryRow[]>((rows, e) => addPayload(rows, JSON.stringify(e)), []);

describe("the rendered view's rows", () => {
  it("merges an item's fragments into one row that shows them joined while it streams", () => {
    const rows = rowsOf([
      text("Hel"),
      text("lo wo"),
      text("rld"),
      callFragment("call_1", "exec_command", '{"cmd":'),
      callFragment("call_1", "", '"ls"}'),
      callFragment("call_2", "read_file", "{}"),
      text("child", ["sub-1"]),
    ]);
    expect(rows).toMatchObject([
      { kind: "item", item: "text", text: "Hello world", open: true },
      { kind: "item", item: "tool_call", name: "exec_command", text: '{"cmd":"ls"}', open: true },
      { kind: "item", item: "tool_call", name: "read_file", text: "{}", open: true },
      { kind: "item", item: "text", text: "child", origin: "sub-1", open: true },
    ]);
  });

  it("shows the .done's content in place of the joined fragments once it arrives", () => {
    const rows = rowsOf([
      text("It's "),
      text("9:30"),
      {
        type: "text.done",
        at: at(0),
        role: "assistant",
        text: "It is 09:30 UTC.",
        stop_reason: "completed",
      },
      callFragment("call_1", "exec_command", '{"cmd": "date"'),
      {
        type: "tool_call.done",
        at: at(0),
        tool_call_id: "call_1",
        name: "exec_command",
        arguments: '{"cmd":"date"}',
        stop_reason: "completed",
      },
    ]);
    expect(rows).toMatchObject([
      { item: "text", text: "It is 09:30 UTC.", open: false },
      { item: "tool_call", text: '{"cmd":"date"}', open: false },
    ]);
    // A .done with no fragments before it is a row of its own, complete from the start.
    expect(rowsOf([TIME_RUN[12]!])).toMatchObject([{ item: "text", open: false }]);
  });

  it("keeps interleaved tool results apart, each on the row of its tool call", () => {
    const rows = rowsOf([
      output("call_1", "a"),
      output("call_2", "x"),
      output("call_1", "b"),
      {
        type: "tool_result.done",
        at: at(0),
        tool_call_id: "call_2",
        output: "xy",
        stop_reason: "completed",
      },
      output("call_1", "c"),
    ]);
    expect(rows).toMatchObject([
      { id: 0, item: "tool_result", text: "abc", open: true },
      { id: 1, item: "tool_result", text: "xy", open: false },
    ]);
  });

  it("joins a summary that has no .done, which its compaction's end completes", () => {
    const summary = (t: string): AmspEvent => ({ type: "summary.delta", at: at(0), text: t });
    const rows = rowsOf([
      {
        type: "compaction.started",
        at: at(0),
        reason: "context",
        mode: "summarize",
        context: 180000,
        turns: 12,
      },
      summary("The user asked "),
      summary("for the time."),
    ]);
    expect(rows.at(-1)).toMatchObject({ item: "summary", text: "The user asked for the time." });
    expect(rows.at(-1)).toMatchObject({ open: true });
    const ended = addPayload(
      rows,
      JSON.stringify({
        type: "compaction.done",
        at: at(0),
        reason: "context",
        mode: "summarize",
        status: "completed",
        usage: null,
      }),
    );
    expect(ended.map((r) => (r.kind === "item" ? r.item : r.type))).toEqual([
      "compaction.started",
      "summary",
      "compaction.done",
    ]);
    expect(ended[1]).toMatchObject({ text: "The user asked for the time.", open: false });
  });

  it("numbers rows in the order they first appear, a merged row keeping its number", () => {
    const state = streaming(TIME_RUN);
    expect(rowsShown(state).map((row) => row.split(" ").slice(0, 2).join(" "))).toEqual([
      "1 run.started",
      "2 tools.ready",
      "3 request.started",
      "4 tool_call",
      // Its .done came after Request 1 ended; the row stays where its first fragment put it.
      "5 tool_result",
      "6 request.done",
      "7 request.started",
      "8 text",
      "9 request.done",
      "10 run.done",
    ]);
  });

  it("keeps a payload that is not an AMSP event as a row of its own", () => {
    expect(addPayload([], "not json")).toMatchObject([
      { kind: "event", type: "?", fields: [{ value: "not json" }] },
    ]);
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
      ["anthropic/claude-sonnet-5", "200000"],
      [],
    ],
    ["tools.ready", TIME_RUN[1]!, ["2", "exec_command, read_file"], ["Run a command.", "{"]],
    [
      "mcp_connect.started",
      { type: "mcp_connect.started", at: at(0), servers: ["github", "linear"] },
      ["github, linear"],
      [],
    ],
    [
      "mcp_connect.done",
      {
        type: "mcp_connect.done",
        at: at(0),
        status: "fatal",
        results: [
          { server: "github", transport: "http", status: "completed", duration_ms: 80, tools: 12 },
          { server: "linear", transport: "stdio", status: "fatal", duration_ms: 5 },
        ],
        error: { code: "mcp_connect_failed", message: "linear did not start." },
      },
      ["fatal", "github completed", "linear fatal", "mcp_connect_failed", "linear did not start."],
      [],
    ],
    [
      "compaction.done",
      {
        type: "compaction.done",
        at: at(0),
        reason: "turns",
        mode: "discard",
        status: "completed",
        usage: usage(40, 900),
      },
      ["turns", "mode discard", "completed", "output 40", "total 900"],
      [],
    ],
    ["request.started", { type: "request.started", at: at(0), request: 2 }, ["#2"], []],
    [
      "request.done with usage",
      { type: "request.done", at: at(0), request: 1, status: "completed", usage: usage(5, 77) },
      ["#1", "completed", "output 5", "total 77"],
      [],
    ],
    [
      "a failed request.done to be retried",
      {
        type: "request.done",
        at: at(0),
        request: 1,
        status: "retryable",
        usage: null,
        error: { code: "rate_limited", message: "Slow down." },
        attempt: 1,
        retry_in_ms: 2000,
      },
      ["retryable", "rate_limited", "Slow down.", "attempt 1", "retry_in_ms 2000"],
      ["total"],
    ],
    [
      "approval.requested",
      {
        type: "approval.requested",
        at: at(0),
        tool_call: { tool_call_id: "call_1", name: "exec_command", arguments: '{"cmd":"rm x"}' },
      },
      ["exec_command", '{"cmd":"rm x"}'],
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
      ["context", "mode summarize"],
      [],
    ],
    [
      "hook.fired",
      {
        type: "hook.fired",
        at: at(0),
        hook: "pre_tool_use",
        name: "guard",
        decision: "deny",
        reason: "No deletes.",
      },
      ["pre_tool_use", "guard", "decision deny", "No deletes."],
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
      ["aborted", "requests 2", "output 9", "total 314", "user_abort"],
      [],
    ],
    [
      "an event this panel does not know",
      { type: "plan.updated", at: at(0), steps: 3 } as unknown as AmspEvent,
      ['"steps":3'],
      ["plan.updated", at(0)],
    ],
  ])("the row of %s names its key fields", (_name, event, shows, hides) => {
    const line = eventFields(event)
      .map((f) => (f.name !== undefined ? `${f.name} ${f.value}` : f.value))
      .join(" · ");
    for (const s of shows) expect(line).toContain(s);
    for (const s of hides) expect(line).not.toContain(s);
  });
});

describe("a Try run", () => {
  it("reads as numbered rows with the answer and the indented arguments; the next run continues the Session", async () => {
    const fetch = stubFetch(() => sse([...TIME_RUN, "[DONE]"]));
    const h = harness();
    await runTry(TARGET, h.dispatch, tryBody(h.state), new AbortController().signal);

    expect(fetch.requests.map((r) => [r.method, r.path, r.body])).toEqual([
      ["POST", TRY_PATH, { input: S.agent.apiTryExample }],
    ]);
    expect(h.state).toMatchObject({ running: false, sessionId: SESSION, broken: false });
    const rows = rowsShown(h.state);
    expect(rows[7]).toBe("8 text It is 09:30 UTC.");
    expect(rows[4]).toBe("5 tool_result Fri Oct 9 09:30:00 UTC 2026");
    const [call] = tagged(html(h.state), "api-try-row").filter((r) => r.includes("tool_call"));
    expect(call).toContain('{\n  "cmd": "date"\n}');
    const view = html(h.state);
    expect(view).toContain(SESSION);
    expect(view).toContain("86 / 2728");
    expect(view).toContain("3.2 s");
    // Finished: the input is cleared for a follow-up on the same Session.
    expect(h.state.input).toBe("");
    expect(view).toContain(`placeholder="${S.agent.apiTryFollowUp}"`);

    fetch.answer(() => sse([STARTED, RUN_DONE, "[DONE]"]));
    h.dispatch({ type: "input", text: "And in Tokyo?" });
    await runTry(TARGET, h.dispatch, tryBody(h.state), new AbortController().signal);
    expect(fetch.requests[1]!.body).toEqual({ input: "And in Tokyo?", session_id: SESSION });
    // A new run's output starts empty.
    expect(rowsShown(h.state)).toEqual([
      `1 run.started ${SESSION}`,
      "2 run.done completed requests 2 output 86 total 2728",
    ]);
  });

  it("marks a row still streaming as live while the run lasts, and a complete row not", () => {
    const caret = 'data-live="caret"';
    const mid = streaming([STARTED, text("It is "), text("09:30")]);
    expect(tagged(html(mid), "api-try-row")[1]).toContain(caret);
    // Arguments that do not parse yet show as received, and a call with none yet shows its tool.
    const calling = streaming([
      STARTED,
      callFragment("call_1", "exec_command", '{"cmd": "da'),
      callFragment("call_2", "read_file", ""),
    ]);
    expect(rowsShown(calling).slice(1)).toEqual([
      '2 tool_call exec_command {"cmd": "da ▌',
      "3 tool_call read_file ▌",
    ]);
    const done = streaming(TIME_RUN.slice(0, 13));
    expect(tagged(html(done), "api-try-row").some((r) => r.includes(caret))).toBe(false);
    // A run that ended mid-item leaves the item as it was, no longer live.
    const ended = reduceTry(mid, { type: "ended" });
    expect(tagged(html(ended), "api-try-row")[1]).not.toContain(caret);
    expect(rowsShown(ended)[1]).toBe("2 text It is 09:30");
  });

  it("shows inline media as its type and size, never its bytes", () => {
    const data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk";
    const state = streaming([
      STARTED,
      {
        type: "inline_data.done",
        at: at(1),
        role: "assistant",
        mime_type: "image/png",
        data,
        stop_reason: "completed",
      },
    ]);
    expect(rowsShown(state)[1]).toBe("2 inline_data image/png 45B");
    expect(html(state)).not.toContain(data);

    // Fragments of one inline item add up; an image input names a data URL's type and size,
    // and any other URL as it is.
    const media = streaming([
      STARTED,
      ...[data, data].map(
        (d) =>
          ({
            type: "inline_data.delta",
            at: at(1),
            mime_type: "image/png",
            data: d,
          }) as unknown as AmspEvent,
      ),
      {
        type: "image_url.done",
        at: at(2),
        role: "user",
        image_url: `data:image/jpeg;base64,${data}`,
      },
      {
        type: "image_url.done",
        at: at(3),
        role: "user",
        image_url: "https://example.test/cat.png",
      },
    ]);
    expect(rowsShown(media).slice(1)).toEqual([
      "2 inline_data image/png 90B ▌",
      "3 image_url image/jpeg 45B",
      "4 image_url https://example.test/cat.png",
    ]);
  });

  it("says on the row what sets an item apart: a text the harness sent, a call cut short, a result's images", () => {
    const state = streaming([
      STARTED,
      {
        type: "text.done",
        at: at(1),
        role: "user",
        sender: "harness",
        text: "Keep going.",
        stop_reason: "completed",
      },
      {
        type: "tool_call.done",
        at: at(2),
        tool_call_id: "call_1",
        name: "exec_command",
        arguments: '{"cmd":"sl',
        stop_reason: "aborted",
      },
      {
        type: "tool_result.done",
        at: at(3),
        tool_call_id: "call_2",
        output: "Read 1 image.",
        images: ["data:image/png;base64,AAAA"],
        stop_reason: "completed",
      },
    ]);
    expect(rowsShown(state).slice(1)).toEqual([
      "2 text harness Keep going.",
      '3 tool_call aborted exec_command {"cmd":"sl',
      "4 tool_result images 1 Read 1 image.",
    ]);
  });

  it("marks a child Session's rows with the chain they came from", () => {
    const state = streaming([STARTED, text("Looking.", ["research", "sub-1"])]);
    const [, child] = tagged(html(state), "api-try-row");
    expect(child).toContain('data-tooltip="research/sub-1"');
    expect(words(child!)).toBe("2 ↳ text Looking. ▌");
  });

  it.each([
    [900, 120],
    [900, 0],
    [0, 0],
  ])(
    "shows cache read %i and cache write %i in the outcome strip, each only when not zero",
    async (read, write) => {
      const counts: TokenCounts = { cache_read: read, cache_write: write, output: 5, total: 50 };
      stubFetch(() => sse([STARTED, { ...RUN_DONE, usage: counts }, "[DONE]"]));
      const h = harness();
      await runTry(TARGET, h.dispatch, tryBody(h.state), new AbortController().signal);
      const strip = words(html(h.state).split('data-slot="foot"')[1] ?? "");
      expect(strip).toContain("5 / 50");
      for (const [label, n] of [
        [S.agent.apiTryCacheRead, read],
        [S.agent.apiTryCacheWrite, write],
      ] as const) {
        if (n > 0) expect(strip).toContain(`${label} ${n}`);
        else expect(strip).not.toContain(label);
      }
    },
  );

  it("prints one numbered line per payload in the raw view, [DONE] last, and copies exactly them", async () => {
    stubFetch(() => sse([...TIME_RUN, "[DONE]"]));
    const h = harness();
    await runTry(TARGET, h.dispatch, tryBody(h.state), new AbortController().signal);
    const lines = [...TIME_RUN.map((e) => `data: ${JSON.stringify(e)}`), "data: [DONE]"];
    expect(rawShown(h.state)).toEqual(lines.map((line, i) => `${i + 1} ${line}`));
    expect(tagged(html(h.state, { view: "raw" }), "api-try-row")).toEqual([]);

    const copies = find(ApiTryView(viewProps(h.state, { view: "raw" })), CopyButton).filter(
      (c) => c.props.label === S.agent.apiTryCopyRaw,
    );
    expect(copies.map((c) => c.props.text)).toEqual([lines.join("\n")]);
  });

  it("shows a refusal before the stream as its status, code and message, with no rows", async () => {
    stubFetch(() => apiError(409, "task_in_progress", "The Session is busy."));
    const h = harness();
    await runTry(TARGET, h.dispatch, tryBody(h.state), new AbortController().signal);
    expect(h.state).toMatchObject({ running: false, rows: [], broken: false });
    const view = html(h.state);
    expect(view).toContain("409 task_in_progress — The Session is busy.");
    expect(rowsShown(h.state)).toEqual([]);
    expect(view).not.toContain(S.agent.apiTryStreamBroken);
  });

  it("says the stream broke when the body ends before run.done, keeping the rows so far", async () => {
    stubFetch(() => sse(TIME_RUN.slice(0, 3)));
    const h = harness();
    await runTry(TARGET, h.dispatch, tryBody(h.state), new AbortController().signal);
    expect(h.state).toMatchObject({ running: false, broken: true, result: null });
    expect(rowsShown(h.state)).toHaveLength(3);
    const view = html(h.state);
    expect(view.indexOf(S.agent.apiTryStreamBroken)).toBeGreaterThan(
      view.lastIndexOf('data-testid="api-try-row"'),
    );
    // The Session it named is kept: the next run can continue it.
    expect(tryBody(h.state)).toMatchObject({ session_id: SESSION });
  });

  it("stops a run that named its Session through the Session's abort route, and shows the stream's run.done aborted", async () => {
    let body: ReturnType<typeof live> | null = null;
    const fetch = stubFetch((req) => {
      if (req.path === TRY_PATH) {
        body = live(req.signal);
        body.send(STARTED, TIME_RUN[9]!, TIME_RUN[10]!);
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
    await vi.waitFor(() => expect(h.state.rows).toHaveLength(3));
    expect(h.state.running).toBe(true);

    await stopTry(h.state, connection);
    await running;
    expect(fetch.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      `POST ${TRY_PATH}`,
      `POST /api/sessions/${SESSION}/abort`,
    ]);
    expect(connection.signal.aborted).toBe(false);
    expect(rowsShown(h.state).at(-1)).toContain("run.done aborted");
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
    // Waiting for the first event: the box holds the live caret and nothing else.
    expect(html(h.state).split('data-testid="api-try-output"')[1]).toContain('data-live="caret"');

    await stopTry(h.state, connection);
    await running;
    expect(fetch.requests[0]!.signal?.aborted).toBe(true);
    expect(fetch.requests).toHaveLength(1);
    expect(h.state).toMatchObject({ running: false, broken: false, error: null, rows: [] });
    const view = html(h.state);
    expect(view).not.toContain(S.agent.apiTryStreamBroken);
    // The box is back to where it was before any run.
    expect(view).toContain(S.agent.apiTryEmpty);
  });

  it("offers Allow and Deny on an approval row; an answer posts the decision and its buttons go", async () => {
    let body: ReturnType<typeof live> | null = null;
    const asked: AmspEvent = {
      type: "approval.requested",
      at: at(530),
      tool_call: { tool_call_id: "call_1", name: "exec_command", arguments: '{"cmd":"date"}' },
    };
    const fetch = stubFetch((req) => {
      if (req.path === TRY_PATH) {
        body = live(req.signal);
        body.send(STARTED, TIME_RUN[2]!, TIME_RUN[5]!, asked);
        return body.response;
      }
      if (req.path === `/api/sessions/${SESSION}/approvals/call_1`) {
        body!.send(
          { type: "approval.decided", at: at(600), tool_call_id: "call_1", decision: "allow" },
          ...TIME_RUN.slice(7),
          "[DONE]",
        );
        body!.close();
        return new Response(null, { status: 204 });
      }
      return apiError(404, "not_found");
    });
    const h = harness();
    const running = runTry(TARGET, h.dispatch, tryBody(h.state), new AbortController().signal);
    await vi.waitFor(() =>
      expect(h.state.rows.at(-1)).toMatchObject({ type: "approval.requested" }),
    );
    expect(rowsShown(h.state).at(-1)).toContain("approval.requested exec_command");

    const [row] = tagged(html(h.state), "api-try-row").filter((r) => r.includes("approval"));
    expect(words(row!)).toContain(`${S.chat.approve} ${S.chat.deny}`);
    const onApprove = vi.fn(async () => {});
    const [decide] = approvalsOn(h.state, { onApprove });
    await decide!("allow");
    expect(onApprove).toHaveBeenCalledExactlyOnceWith("call_1", "allow");

    await answerApproval(SESSION, "call_1", "allow", h.dispatch);
    expect(fetch.requests.at(-1)).toMatchObject({
      method: "POST",
      path: `/api/sessions/${SESSION}/approvals/call_1`,
      body: { decision: "allow" },
    });
    expect(approvalsOn(h.state)).toEqual([]);
    await running;
    expect(rowsShown(h.state)).toContain("5 approval.decided allow");
    expect(h.state.result?.run.status).toBe("completed");
  });

  it("clears an approval's buttons when it was decided elsewhere, or when the run ended", () => {
    const asked: AmspEvent = {
      type: "approval.requested",
      at: at(1),
      tool_call: { tool_call_id: "call_1", name: "exec_command", arguments: "{}" },
    };
    const waiting = streaming([STARTED, asked]);
    expect(approvalsOn(waiting)).toHaveLength(1);
    const decided = reduceTry(waiting, {
      type: "payload",
      data: JSON.stringify({
        type: "approval.decided",
        at: at(2),
        tool_call_id: "call_1",
        decision: "deny",
      }),
    });
    expect(approvalsOn(decided)).toEqual([]);
    const ended = reduceTry(waiting, { type: "ended" });
    expect(approvalsOn(ended)).toEqual([]);
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
      rows: [],
      payloads: [],
      result: null,
    });
    expect(tryBody(h.state)).toEqual({ input: "Again from the start" });
    expect(html(h.state)).not.toContain(SESSION);
  });
});
