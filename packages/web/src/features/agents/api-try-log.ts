/**
 * The API tab's Try it, without React: the state of one panel, the reducer that folds a run's
 * stream into it, and the async driver that feeds it.
 *
 * A run is the Agent API's own run, sent through the owner's try route (`tryAgentApi`) and read
 * with the SDK's `readSse`, so the panel sees exactly the `data:` payloads a program would. Every
 * payload is kept verbatim: the raw view prints them back, one numbered line each. The rendered
 * view reads the same payloads as rows, one per item or event:
 *
 * - An item's fragments and its complete form are one row (`text`, `thinking`, `tool_call`,
 *   `tool_result`, `summary`, the inline media). While fragments arrive the row shows them joined;
 *   once the `.done` arrives it shows the `.done`'s content instead. The two are the same item, so
 *   nothing compares them: the latest is what shows. Fragments find their row by the item they
 *   belong to — a tool call or result by its `tool_call_id`, since results interleave — so a row
 *   keeps its place when other rows come between its fragments.
 * - Every other event is a row of its own, with its key fields.
 *
 * `run.done` gives the status strip, folded by the SDK's `RunCollector` as a program's
 * `result()` would be. The Session id that `run.started` names stays after the run, so the next
 * run continues the conversation, the way a program passes `session_id`; New conversation
 * forgets it.
 */
import { readSse, RunCollector } from "@prismshadow/amsp";
import type { AmspError, AmspEvent, RunRequest, RunResult, TokenCounts } from "@prismshadow/amsp";
import { ApiError } from "../../api/client";
import * as api from "../../api/endpoints";

/** Where a one-line value is cut, so one long argument string does not take the row. */
const CUT = 120;

const cut = (text: string): string => (text.length > CUT ? `${text.slice(0, CUT)}…` : text);

/** One value of an event row: the wire name it is known by (if any) and the value. */
export interface TryField {
  name?: string;
  value: string;
  /** Free text (a message, a list of names) rather than a value to pick out. */
  quiet?: boolean;
}

/** A row standing for one item: its fragments, its complete form, or both. */
export interface TryItemRow {
  kind: "item";
  /** The row's place in the rendered view, from 0; it never moves. */
  id: number;
  /** What the item is: its events' type before `.delta` / `.done` (`text`, `tool_call`, …). */
  item: string;
  /** The item its fragments and `.done` belong to. */
  key: string;
  /** Fragments arrived and nothing has said the item is complete yet. */
  open: boolean;
  /**
   * The content so far: the fragments joined, or the `.done`'s own once it came. A text, a
   * thinking or a summary's text; a tool call's arguments; a tool result's output.
   */
  text: string;
  /** A tool call's tool. */
  name?: string;
  /** Inline media and image inputs: what they are and how big, never the bytes themselves. */
  media?: { mime: string; bytes: number };
  /** How many images a tool result carries. */
  images?: number;
  /** What sets the item apart from the plain case: a text's sender, a stop other than completed. */
  tags: string[];
  /** The child Session chain it came from, outer→inner; absent for the main Session. */
  origin?: string;
}

/** A row standing for one event that is not part of an item. */
export interface TryEventRow {
  kind: "event";
  id: number;
  /** The event's `type`; `?` for a payload that is not an AMSP event. */
  type: string;
  fields: TryField[];
  /** On `approval.requested`: the call it asks about, and whether an answer is still open. */
  approval?: { toolCallId: string; pending: boolean };
  origin?: string;
}

export type TryRow = TryItemRow | TryEventRow;

/** The label a row carries in the rendered view: the item's kind, or the event's type. */
export const rowLabel = (row: TryRow): string => (row.kind === "item" ? row.item : row.type);

/** The kinds of item whose events merge into one row. */
const ITEMS = new Set([
  "text",
  "thinking",
  "tool_call",
  "tool_result",
  "summary",
  "inline_data",
  "inline_thinking",
  "image_url",
]);

/** The field that carries an item's text, on its fragments and on its `.done` alike. */
const TEXT_FIELD: Record<string, string> = {
  text: "text",
  thinking: "thinking",
  summary: "text",
  tool_call: "arguments",
  tool_result: "output",
};

/** The payload as an AMSP event, or null when it is not one (not JSON, or no `type`). */
function parseEvent(payload: string): AmspEvent | null {
  try {
    const value: unknown = JSON.parse(payload);
    return value !== null &&
      typeof value === "object" &&
      typeof (value as { type?: unknown }).type === "string"
      ? (value as AmspEvent)
      : null;
  } catch {
    return null;
  }
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** The size of base64 data once decoded. */
function base64Bytes(data: string): number {
  const body = data.replace(/[\s=]/g, "");
  return Math.floor((body.length * 3) / 4);
}

/** A `data:` URL's media type and decoded size; null for any other URL. */
function dataUrlMedia(url: string): { mime: string; bytes: number } | null {
  const match = /^data:([^;,]*)(;base64)?,/.exec(url);
  if (match === null) return null;
  const body = url.slice(match[0].length);
  return {
    mime: match[1] || "text/plain",
    bytes: match[2] !== undefined ? base64Bytes(body) : body.length,
  };
}

const originOf = (ev: AmspEvent): string | undefined =>
  ev.origin !== undefined && ev.origin.length > 0 ? ev.origin.join("/") : undefined;

/** The row an item's event belongs to, as it reads after that event. */
function itemRow(
  prev: TryItemRow | undefined,
  id: number,
  ev: AmspEvent,
  item: string,
  done: boolean,
) {
  const f = ev as unknown as Record<string, unknown>;
  const field = TEXT_FIELD[item];
  const piece = field !== undefined ? str(f[field]) : "";
  const origin = originOf(ev);
  const row: TryItemRow = prev
    ? { ...prev, tags: [...prev.tags] }
    : {
        kind: "item",
        id,
        item,
        key: itemKey(ev, item),
        open: true,
        text: "",
        tags: [],
        ...(origin !== undefined ? { origin } : {}),
      };
  // A complete item replaces whatever its fragments said; a fragment adds to it.
  row.text = done ? piece : row.text + piece;
  if (item === "tool_call") {
    const name = str(f.name);
    if (done || row.name === undefined || row.name === "") row.name = name;
  }
  // A result's images are never fragmented: whichever event carries them carries the whole set.
  if (Array.isArray(f.images)) row.images = f.images.length;
  if (item === "inline_data" || item === "inline_thinking") {
    const bytes = base64Bytes(str(f.data));
    row.media = {
      mime: str(f.mime_type) || row.media?.mime || "",
      bytes: done ? bytes : (row.media?.bytes ?? 0) + bytes,
    };
  }
  if (item === "image_url") {
    const url = str(f.image_url);
    const media = dataUrlMedia(url);
    if (media !== null) row.media = media;
    else row.text = url;
  }
  if (done) {
    row.open = false;
    // An image input is the user's by definition; elsewhere a user-role item is the exception.
    if (f.role === "user" && item !== "image_url") row.tags.push(str(f.sender) || "user");
    const stop = str(f.stop_reason);
    if (stop !== "" && stop !== "completed") row.tags.push(stop);
  }
  return row;
}

/** Which item an event belongs to: its kind, role, tool call and Session. */
function itemKey(ev: AmspEvent, item: string): string {
  const f = ev as unknown as Record<string, unknown>;
  return [item, str(f.role), str(f.tool_call_id), originOf(ev) ?? ""].join(" ");
}

const tokens = (usage: TokenCounts | null): TryField[] =>
  usage === null
    ? []
    : [
        { name: "output", value: String(usage.output) },
        { name: "total", value: String(usage.total) },
      ];

const failure = (error: AmspError | undefined): TryField[] =>
  error === undefined ? [] : [{ value: error.code }, { value: error.message, quiet: true }];

/** The key fields of an event that stands alone, in the order its row shows them. */
export function eventFields(ev: AmspEvent): TryField[] {
  switch (ev.type) {
    case "run.started":
      return [{ value: ev.session_id }];
    case "run.done":
      return [
        { value: ev.status },
        { name: "requests", value: String(ev.requests) },
        ...tokens(ev.usage),
        ...failure(ev.error),
      ];
    case "context.opened":
      return [
        { value: `${ev.provider}/${ev.model_id}` },
        { name: "context_window", value: String(ev.context_window) },
      ];
    case "mcp_connect.started":
      return [{ value: ev.servers.join(", ") }];
    case "mcp_connect.done":
      return [
        { value: ev.status },
        ...ev.results.map((r) => ({ name: r.server, value: r.status })),
        ...failure(ev.error),
      ];
    case "tools.ready":
      return [
        { value: String(ev.tools.length) },
        { value: ev.tools.map((t) => t.name).join(", "), quiet: true },
      ];
    case "request.started":
      return [{ value: `#${ev.request}` }];
    case "request.done":
      return [
        { value: `#${ev.request}` },
        { value: ev.status },
        ...tokens(ev.usage),
        ...(ev.attempt !== undefined ? [{ name: "attempt", value: String(ev.attempt) }] : []),
        ...(ev.retry_in_ms !== undefined
          ? [{ name: "retry_in_ms", value: String(ev.retry_in_ms) }]
          : []),
        ...failure(ev.error),
      ];
    case "approval.requested":
      return [{ value: ev.tool_call.name }, { value: cut(ev.tool_call.arguments), quiet: true }];
    case "approval.decided":
      return [{ value: ev.decision }];
    case "compaction.started":
      return [
        { value: ev.reason },
        { name: "mode", value: ev.mode },
        { name: "context", value: String(ev.context) },
        { name: "turns", value: String(ev.turns) },
      ];
    case "compaction.done":
      return [
        { value: ev.reason },
        { name: "mode", value: ev.mode },
        { value: ev.status },
        ...tokens(ev.usage),
        ...failure(ev.error),
      ];
    case "hook.fired":
      return [
        { value: ev.hook },
        { value: ev.name },
        ...(ev.decision !== undefined ? [{ name: "decision", value: ev.decision }] : []),
        ...(ev.reason !== undefined ? [{ value: ev.reason, quiet: true }] : []),
      ];
    default: {
      // A type this panel does not know (the protocol adds them within /v1): what it carries.
      const rest = Object.fromEntries(
        Object.entries(ev).filter(([field]) => field !== "type" && field !== "at"),
      );
      return [{ value: cut(JSON.stringify(rest)), quiet: true }];
    }
  }
}

/** The rows with every open item that `close` picks marked complete. */
function closeOpen(rows: TryRow[], close: (row: TryItemRow) => boolean): TryRow[] {
  return rows.map((row) =>
    row.kind === "item" && row.open && close(row) ? { ...row, open: false } : row,
  );
}

/**
 * The rendered view's rows with one more payload: an item's event lands on that item's open row
 * (or opens one), anything else is a row of its own. Rows keep their places.
 */
export function addPayload(rows: readonly TryRow[], payload: string): TryRow[] {
  const id = rows.length;
  const ev = parseEvent(payload);
  if (ev === null) {
    return [
      ...rows,
      { kind: "event", id, type: "?", fields: [{ value: cut(payload), quiet: true }] },
    ];
  }
  const dot = ev.type.lastIndexOf(".");
  const item = ev.type.slice(0, dot);
  const phase = ev.type.slice(dot + 1);
  if (ITEMS.has(item) && (phase === "delta" || phase === "done")) {
    const key = itemKey(ev, item);
    const at = rows.findLastIndex((r) => r.kind === "item" && r.open && r.key === key);
    const prev = at >= 0 ? (rows[at] as TryItemRow) : undefined;
    const row = itemRow(prev, id, ev, item, phase === "done");
    return at >= 0 ? rows.map((r, i) => (i === at ? row : r)) : [...rows, row];
  }
  const origin = originOf(ev);
  let kept = [...rows];
  // A streamed summary has no `.done`: its compaction's end is what completes it.
  if (ev.type === "compaction.done") {
    kept = closeOpen(kept, (r) => r.item === "summary" && r.origin === origin);
  }
  // Nothing of a run is still coming after its end.
  if (ev.type === "run.done") kept = closeOpen(kept, () => true);
  return [
    ...kept,
    {
      kind: "event",
      id,
      type: ev.type,
      fields: eventFields(ev),
      ...(origin !== undefined ? { origin } : {}),
      ...(ev.type === "approval.requested"
        ? { approval: { toolCallId: ev.tool_call.tool_call_id, pending: true } }
        : {}),
    },
  ];
}

/** Milliseconds from `run.started` to `run.done`, by the server's clock; null when unreadable. */
export function elapsedMs(started: string, done: string): number | null {
  const ms = Date.parse(done) - Date.parse(started);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

/** The two views of a run: its rows with fragments merged, or its payloads as received. */
export type TryView = "rendered" | "raw";

export interface TryState {
  input: string;
  running: boolean;
  /** The Session the last run named: the next run continues it. */
  sessionId: string | null;
  /** The current run's `run.started` time; null until it arrives, so Stop knows whom to ask. */
  startedAt: string | null;
  /** The current run's payloads, exactly as received. */
  payloads: string[];
  /** The rendered view's rows. */
  rows: TryRow[];
  view: TryView;
  /** The run's outcome, once `run.done` arrived. */
  result: { run: RunResult; elapsedMs: number | null } | null;
  /** A refusal before the stream. */
  error: { status: number; code: string; message: string } | null;
  /** The body ended before `run.done`. */
  broken: boolean;
  /** `[DONE]` arrived. */
  closed: boolean;
}

export type TryAction =
  | { type: "input"; text: string }
  | { type: "start" }
  | { type: "payload"; data: string }
  | { type: "httpError"; status: number; code: string; message: string }
  /** The body closed; `stopped` when it was this panel that closed it (Stop before run.started, leaving). */
  | { type: "ended"; stopped?: boolean }
  | { type: "view"; view: TryView }
  | { type: "decided"; toolCallId: string }
  | { type: "reset" };

/** The panel before its first run: the example in the input, no Session. */
export function initialTryState(input: string): TryState {
  return {
    input,
    running: false,
    sessionId: null,
    startedAt: null,
    payloads: [],
    rows: [],
    view: "rendered",
    result: null,
    error: null,
    broken: false,
    closed: false,
  };
}

/** The rows with the approval of `toolCallId` (or, without one, every approval) no longer open. */
function settle(rows: TryRow[], toolCallId?: string): TryRow[] {
  return rows.map((r) =>
    r.kind === "event" &&
    r.approval?.pending === true &&
    (toolCallId === undefined || r.approval.toolCallId === toolCallId)
      ? { ...r, approval: { ...r.approval, pending: false } }
      : r,
  );
}

/** What the run comes to, folded from every payload it sent; null when the stream never said. */
function resultOf(payloads: readonly string[], doneAt: string, startedAt: string | null) {
  const collector = new RunCollector();
  for (const payload of payloads) {
    const ev = parseEvent(payload);
    if (ev !== null) collector.add(ev);
  }
  try {
    return {
      run: collector.result(),
      elapsedMs: startedAt === null ? null : elapsedMs(startedAt, doneAt),
    };
  } catch {
    return null;
  }
}

export function reduceTry(state: TryState, action: TryAction): TryState {
  switch (action.type) {
    case "input":
      return { ...state, input: action.text };
    case "start":
      return {
        ...state,
        running: true,
        startedAt: null,
        payloads: [],
        rows: [],
        result: null,
        error: null,
        broken: false,
        closed: false,
      };
    case "payload": {
      if (action.data === "[DONE]") return { ...state, closed: true };
      const payloads = [...state.payloads, action.data];
      const rows = addPayload(state.rows, action.data);
      const ev = parseEvent(action.data);
      if (ev?.type === "run.started") {
        return { ...state, payloads, rows, sessionId: ev.session_id, startedAt: ev.at };
      }
      if (ev?.type === "approval.decided") {
        return { ...state, payloads, rows: settle(rows, ev.tool_call_id) };
      }
      if (ev?.type === "run.done") {
        // Finished: the input clears for a follow-up on the same Session.
        return {
          ...state,
          payloads,
          rows: settle(rows),
          result: resultOf(payloads, ev.at, state.startedAt),
          input: "",
        };
      }
      return { ...state, payloads, rows };
    }
    case "httpError":
      return {
        ...state,
        running: false,
        error: { status: action.status, code: action.code, message: action.message },
      };
    case "ended":
      return {
        ...state,
        running: false,
        rows: settle(closeOpen(state.rows, () => true)),
        broken: action.stopped !== true && state.result === null && state.error === null,
      };
    case "view":
      return { ...state, view: action.view };
    case "decided":
      return { ...state, rows: settle(state.rows, action.toolCallId) };
    case "reset":
      return { ...initialTryState(state.input), view: state.view };
  }
}

/** The request the next run sends: the input, and the Session to continue once there is one. */
export function tryBody(state: TryState): RunRequest {
  return {
    input: state.input,
    ...(state.sessionId !== null ? { session_id: state.sessionId } : {}),
  };
}

/** The `data:` lines as received, `[DONE]` last once it came: what the raw view prints. */
export function rawLines(state: Pick<TryState, "payloads" | "closed">): string[] {
  const lines = state.payloads.map((payload) => `data: ${payload}`);
  return state.closed ? [...lines, "data: [DONE]"] : lines;
}

/** The Agent a run goes to. */
export interface TryTarget {
  projectId: string;
  agentId: string;
}

/**
 * One run: the request through the try route, then one `payload` per event of the body as it
 * arrives, then `ended`. A refusal before the stream is `httpError`; aborting `signal` (Stop
 * before run.started, or leaving the tab) ends it as stopped.
 */
export async function runTry(
  target: TryTarget,
  dispatch: (action: TryAction) => void,
  body: RunRequest,
  signal: AbortSignal,
): Promise<void> {
  dispatch({ type: "start" });
  try {
    const res = await api.tryAgentApi(target.projectId, target.agentId, body, { signal });
    if (res.body !== null) {
      for await (const data of readSse(res.body)) dispatch({ type: "payload", data });
    }
    dispatch({ type: "ended" });
  } catch (err) {
    if (signal.aborted) dispatch({ type: "ended", stopped: true });
    else if (err instanceof ApiError) {
      dispatch({ type: "httpError", status: err.status, code: err.code, message: err.message });
    } else dispatch({ type: "ended" });
  }
}

/**
 * Stop: once the run has named its Session, the Session's abort route — the stream stays open
 * and ends with `run.done` aborted, as a program sees it; before that, the request itself is
 * aborted.
 */
export async function stopTry(state: TryState, controller: AbortController | null): Promise<void> {
  if (state.startedAt !== null && state.sessionId !== null) {
    await api.postAbort(state.sessionId);
    return;
  }
  controller?.abort();
}

/**
 * An inline answer to an approval the run asked for, through the Session's approvals route; its
 * buttons go at once, and the stream's `approval.decided` says how it was decided.
 */
export async function answerApproval(
  sessionId: string,
  toolCallId: string,
  decision: "allow" | "deny",
  dispatch: (action: TryAction) => void,
): Promise<void> {
  await api.postApproval(sessionId, toolCallId, { decision });
  dispatch({ type: "decided", toolCallId });
}
