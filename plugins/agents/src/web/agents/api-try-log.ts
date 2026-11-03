/**
 * The API tab's Try it, without React: the state of one panel, the reducer that folds a run into
 * it, and the async driver that feeds it.
 *
 * A run is the Agent API's own run, sent through the owner's try route and read by the SDK's
 * `AgentClient` over a transport of the Web App's routes (api-try-transport.ts), so the panel sees
 * the records a program would. The raw view prints them back, one numbered `data:` line each. The
 * rendered view reads the same records as rows, one per item or event, labelled by the record's
 * `payload.type`:
 *
 * - A message's `partial_*` fragments and its complete record are one row (`text`, `thinking`,
 *   `tool_call`, `tool_call_output`). While fragments arrive the row shows them joined; once the
 *   complete record arrives it shows that record's content instead. The two are the same message,
 *   so nothing compares them: the latest is what shows. Fragments find their row by the message
 *   they belong to — a tool call or its output by its `tool_call_id` — so a row keeps its place
 *   when other rows come between its fragments.
 * - Every other record is a row of its own, with its key fields. The control frame `ping` is not
 *   a row.
 *
 * The outcome strip is the SDK's `RunResult`. The Session the run is on (a new one's is named by
 * its `session_meta`) stays after the run, so the next run continues the conversation, the way a
 * program passes `session_id`; New conversation forgets it. An approval the Agent's API approval
 * mode asks for reaches the panel through the SDK's approval loop: the `tool_call` row it is
 * about offers Allow and Deny, and the answer goes back through the SDK.
 */
import { AgentClient, AmspHttpError } from "@prismshadow/amsp";
import type {
  AmspRecord,
  RunRequest,
  RunResult,
  TokenCounts,
  ToolCallPayload,
} from "@prismshadow/amsp";
import * as api from "../../api/endpoints";
import { tryTransport } from "./api-try-transport";

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

/** A row standing for one message: its fragments, its complete record, or both. */
export interface TryItemRow {
  kind: "item";
  /** The row's place in the rendered view, from 0; it never moves. */
  id: number;
  /** The complete record's `payload.type` (`text`, `tool_call`, …), fragments included. */
  label: string;
  /** The message its fragments and complete record belong to. */
  key: string;
  /** Fragments arrived and the complete record has not yet. */
  open: boolean;
  /**
   * The content so far: the fragments joined, or the complete record's own once it came. A text
   * or a thinking's text; a tool call's arguments; a tool output's output.
   */
  text: string;
  /** A tool call's tool. */
  name?: string;
  /** Inline media and image inputs: what they are and how big, never the bytes themselves. */
  media?: { mime: string; bytes: number };
  /** How many images a tool output carries. */
  images?: number;
  /** What sets the message apart from the plain case: a text's sender, a stop other than completed. */
  tags: string[];
  /** The child Session chain it came from, outer→inner; absent for the main Session. */
  origin?: string;
  /** On a tool call: its id, and whether the run waits on an answer here. */
  approval?: { toolCallId: string; pending: boolean };
}

/** A row standing for one record that is not part of a message. */
export interface TryEventRow {
  kind: "event";
  id: number;
  /** The record's `payload.type`, or `session_meta`. */
  label: string;
  fields: TryField[];
  origin?: string;
}

export type TryRow = TryItemRow | TryEventRow;

/** The label a row carries in the rendered view. */
export const rowLabel = (row: TryRow): string => row.label;

/** The fragment types, by the complete record they lead to. */
const PARTIAL_OF: Record<string, string> = {
  partial_text: "text",
  partial_thinking: "thinking",
  partial_tool_call: "tool_call",
  partial_tool_call_output: "tool_call_output",
};

/** The messages a row holds: complete records that merge with fragments or carry media. */
const MESSAGES = new Set([
  "text",
  "thinking",
  "tool_call",
  "tool_call_output",
  "inline_data",
  "inline_thinking",
  "image_url",
]);

/** The field that carries a message's text, on its fragments and on its complete record alike. */
const TEXT_FIELD: Record<string, string> = {
  text: "text",
  thinking: "thinking",
  tool_call: "arguments",
  tool_call_output: "output",
};

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

const originOf = (rec: AmspRecord): string | undefined =>
  rec.origin !== undefined && rec.origin.length > 0 ? rec.origin.join("/") : undefined;

/** A record's payload type, or `session_meta`. */
const typeOf = (rec: AmspRecord): string =>
  rec.type === "session_meta" ? "session_meta" : str((rec.payload as { type?: unknown }).type);

/** Which message a record belongs to: its kind, role, tool call and Session. */
function messageKey(rec: AmspRecord, label: string): string {
  const p = rec.payload as unknown as Record<string, unknown>;
  return [label, str(p.role), str(p.tool_call_id), originOf(rec) ?? ""].join(" ");
}

/** The row a message's record belongs to, as it reads after that record. */
function messageRow(
  prev: TryItemRow | undefined,
  id: number,
  rec: AmspRecord,
  label: string,
  complete: boolean,
): TryItemRow {
  const p = rec.payload as unknown as Record<string, unknown>;
  const field = TEXT_FIELD[label];
  const piece = field !== undefined ? str(p[field]) : "";
  const origin = originOf(rec);
  const row: TryItemRow = prev
    ? { ...prev, tags: [...prev.tags] }
    : {
        kind: "item",
        id,
        label,
        key: messageKey(rec, label),
        open: true,
        text: "",
        tags: [],
        ...(origin !== undefined ? { origin } : {}),
      };
  // A complete record replaces whatever its fragments said; a fragment adds to it.
  row.text = complete ? piece : row.text + piece;
  if (label === "tool_call") {
    const name = str(p.name);
    if (complete || row.name === undefined || row.name === "") row.name = name;
  }
  // An output's images are never fragmented: whichever record carries them carries the whole set.
  if (Array.isArray(p.images)) row.images = p.images.length;
  if (label === "inline_data" || label === "inline_thinking") {
    row.media = { mime: str(p.mime_type), bytes: base64Bytes(str(p.data)) };
  }
  if (label === "image_url") {
    const url = str(p.image_url);
    const media = dataUrlMedia(url);
    if (media !== null) row.media = media;
    else row.text = url;
  }
  if (complete) {
    row.open = false;
    // An image input is the user's by definition; elsewhere a user-role message is the exception.
    if (p.role === "user" && label !== "image_url") row.tags.push(str(p.sender) || "user");
    // A tool result's status, when it is not an ordinary one.
    const status = label === "tool_call_output" ? str(p.status) : "";
    if (status !== "" && status !== "completed") row.tags.push(status);
  }
  return row;
}

const tokens = (usage: TokenCounts | undefined): TryField[] =>
  usage === undefined
    ? []
    : [
        { name: "output", value: String(usage.output) },
        { name: "total", value: String(usage.total) },
      ];

const failure = (p: { error_code?: unknown; error_message?: unknown }): TryField[] => [
  ...(typeof p.error_code === "string" ? [{ value: p.error_code }] : []),
  ...(typeof p.error_message === "string" && p.error_message !== ""
    ? [{ value: p.error_message, quiet: true }]
    : []),
];

const opt = (name: string, value: unknown): TryField[] =>
  value === undefined || value === null ? [] : [{ name, value: String(value) }];

/** The key fields of a record that stands alone, in the order its row shows them. */
export function recordFields(rec: AmspRecord): TryField[] {
  const p = rec.payload as unknown as Record<string, unknown>;
  switch (typeOf(rec)) {
    case "session_meta":
      return [
        { value: `${str(p.provider)}/${str(p.model_id)}` },
        { name: "context_window", value: String(p.model_context_window) },
        ...opt("source", p.source),
      ];
    case "task_begin":
    case "task_end":
      return [];
    case "request_begin":
      return opt("thinking_level", p.thinking_level);
    case "request_end":
      return [
        { value: str(p.status) },
        ...opt("attempt", p.attempt),
        ...opt("retry_in_ms", p.retry_in_ms),
        ...failure(p),
      ];
    case "token_usage":
      return tokens(p.request as TokenCounts | undefined);
    case "mcp_connect_begin":
      return [{ value: (p.servers as string[] | undefined)?.join(", ") ?? "" }];
    case "mcp_connect_end":
      return [
        { value: str(p.status) },
        ...((p.results as Array<{ server: string; status: string }> | undefined) ?? []).map(
          (r) => ({ name: r.server, value: r.status }),
        ),
        ...failure(p),
      ];
    case "tool_list_ready": {
      const tools = (p.tools as Array<{ name: string }> | undefined) ?? [];
      return [
        { value: String(tools.length) },
        { value: tools.map((t) => t.name).join(", "), quiet: true },
      ];
    }
    case "approval_decision":
      return [{ value: str(p.decision) }];
    case "compaction_begin":
      return [
        { value: str(p.reason) },
        { name: "mode", value: str(p.mode) },
        ...opt("context", p.context),
        ...opt("turns", p.turns),
      ];
    case "compaction_end":
      return [
        { value: str(p.reason) },
        { name: "mode", value: str(p.mode) },
        { value: str(p.status) },
        ...failure(p),
      ];
    case "hook":
      return [
        { value: str(p.hook) },
        { value: str(p.name) },
        ...opt("decision", p.decision),
        ...(typeof p.reason === "string" ? [{ value: p.reason, quiet: true }] : []),
      ];
    case "abort":
      return failure(p);
    case "subagent":
      return [{ value: str(p.session_id) }];
    default: {
      // A record this panel does not know (the protocol grows within /v1): what it carries.
      const { type: _type, ...rest } = p;
      return [{ value: cut(JSON.stringify(rest)), quiet: true }];
    }
  }
}

/** The rows with every open message that `close` picks marked complete. */
function closeOpen(rows: TryRow[], close: (row: TryItemRow) => boolean): TryRow[] {
  return rows.map((row) =>
    row.kind === "item" && row.open && close(row) ? { ...row, open: false } : row,
  );
}

/** The rows with the approval on `toolCallId` (or, without one, every approval) no longer waiting. */
function settle(rows: TryRow[], toolCallId?: string): TryRow[] {
  return rows.map((r) =>
    r.kind === "item" &&
    r.approval?.pending === true &&
    (toolCallId === undefined || r.approval.toolCallId === toolCallId)
      ? { ...r, approval: { ...r.approval, pending: false } }
      : r,
  );
}

/**
 * The rendered view's rows with one more record: a message's record lands on that message's open
 * row (or opens one), anything else is a row of its own. Rows keep their places.
 */
export function addRecord(rows: readonly TryRow[], rec: AmspRecord): TryRow[] {
  const id = rows.length;
  const type = typeOf(rec);
  const partialOf = PARTIAL_OF[type];
  if (partialOf !== undefined || MESSAGES.has(type)) {
    const label = partialOf ?? type;
    const complete = partialOf === undefined;
    const key = messageKey(rec, label);
    const at = rows.findLastIndex((r) => r.kind === "item" && r.open && r.key === key);
    const prev = at >= 0 ? (rows[at] as TryItemRow) : undefined;
    let row = messageRow(prev, id, rec, label, complete);
    if (label === "tool_call" && row.approval === undefined) {
      const toolCallId = str((rec.payload as { tool_call_id?: unknown }).tool_call_id);
      row = { ...row, approval: { toolCallId, pending: false } };
    }
    return at >= 0 ? rows.map((r, i) => (i === at ? row : r)) : [...rows, row];
  }
  const origin = originOf(rec);
  let kept = [...rows];
  if (type === "approval_decision") {
    kept = settle(kept, str((rec.payload as { tool_call_id?: unknown }).tool_call_id));
  }
  return [
    ...kept,
    {
      kind: "event",
      id,
      label: type,
      fields: recordFields(rec),
      ...(origin !== undefined ? { origin } : {}),
    },
  ];
}

/** The rows with the tool call `toolCallId` waiting on an answer. */
export function askOn(rows: readonly TryRow[], toolCallId: string): TryRow[] {
  return rows.map((r) =>
    r.kind === "item" && r.label === "tool_call" && r.approval?.toolCallId === toolCallId
      ? { ...r, approval: { toolCallId, pending: true } }
      : r,
  );
}

/** The two views of a run: its rows with fragments merged, or its lines as received. */
export type TryView = "rendered" | "raw";

export interface TryState {
  input: string;
  running: boolean;
  /** The Session the last run named: the next run continues it. */
  sessionId: string | null;
  /** When the current run named its Session (ms); null until then, so Stop knows whom to ask. */
  startedAtMs: number | null;
  /** The current run's lines, as received: one `data:` line per record. */
  lines: string[];
  /** The rendered view's rows. */
  rows: TryRow[];
  view: TryView;
  /** The run's outcome, once the stream reached [DONE]. */
  result: { run: RunResult; elapsedMs: number | null } | null;
  /** A refusal before the stream. */
  error: { status: number; code: string; message: string } | null;
  /** The body ended before [DONE]. */
  broken: boolean;
  /** [DONE] arrived. */
  closed: boolean;
}

export type TryAction =
  | { type: "input"; text: string }
  | { type: "start" }
  /** The run is under way on this Session: the SDK's `run.session` resolved. */
  | { type: "session"; sessionId: string; atMs: number }
  | { type: "record"; record: AmspRecord }
  | { type: "done"; result: RunResult; atMs: number }
  | { type: "httpError"; status: number; code: string; message: string }
  /** The run ended without [DONE]; `stopped` when it was this panel that closed it. */
  | { type: "ended"; stopped?: boolean }
  | { type: "view"; view: TryView }
  /** The run waits on an answer for this tool call. */
  | { type: "asking"; toolCallId: string }
  /** An answer was given here: the buttons go. */
  | { type: "decided"; toolCallId: string }
  | { type: "reset" };

/** The panel before its first run: the example in the input, no Session. */
export function initialTryState(input: string): TryState {
  return {
    input,
    running: false,
    sessionId: null,
    startedAtMs: null,
    lines: [],
    rows: [],
    view: "rendered",
    result: null,
    error: null,
    broken: false,
    closed: false,
  };
}

export function reduceTry(state: TryState, action: TryAction): TryState {
  switch (action.type) {
    case "input":
      return { ...state, input: action.text };
    case "start":
      return {
        ...state,
        running: true,
        startedAtMs: null,
        lines: [],
        rows: [],
        result: null,
        error: null,
        broken: false,
        closed: false,
      };
    case "session":
      return { ...state, sessionId: action.sessionId, startedAtMs: action.atMs };
    case "record":
      return {
        ...state,
        lines: [...state.lines, `data: ${JSON.stringify(action.record)}`],
        rows: addRecord(state.rows, action.record),
      };
    case "done":
      // Finished: the input clears for a follow-up on the same Session.
      return {
        ...state,
        running: false,
        closed: true,
        lines: [...state.lines, "data: [DONE]"],
        rows: settle(closeOpen(state.rows, () => true)),
        result: {
          run: action.result,
          elapsedMs: state.startedAtMs === null ? null : action.atMs - state.startedAtMs,
        },
        input: "",
      };
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
    case "asking":
      return { ...state, rows: askOn(state.rows, action.toolCallId) };
    case "decided":
      return { ...state, rows: settle(state.rows, action.toolCallId) };
    case "reset":
      return { ...initialTryState(state.input), view: state.view };
  }
}

/** Whether a finished run did not reach its end: its last task_begin was never closed. */
export const unfinished = (run: RunResult): boolean =>
  run.status === "fatal" && run.error?.code === "internal";

/** The request the next run sends: the input, and the Session to continue once there is one. */
export function tryBody(state: TryState): RunRequest {
  return {
    input: state.input,
    ...(state.sessionId !== null ? { session_id: state.sessionId } : {}),
  };
}

/** The lines as received, `[DONE]` last once it came: what the raw view prints. */
export function rawLines(state: Pick<TryState, "lines">): string[] {
  return state.lines;
}

/** The Agent a run goes to. */
export interface TryTarget {
  projectId: string;
  agentId: string;
  /** The machine it lives on, where the run and its Session are; null (or absent) for this server. */
  machineId?: string | null;
}

/**
 * The answers the panel owes the SDK's approval loop: each question waits here until a button
 * answers it, or the run ends (`deny`, which the loop no longer posts).
 */
export function approvalDesk(dispatch: (action: TryAction) => void) {
  const waiting = new Map<string, (answer: "allow" | "deny") => void>();
  return {
    ask(toolCall: ToolCallPayload): Promise<"allow" | "deny"> {
      dispatch({ type: "asking", toolCallId: toolCall.tool_call_id });
      return new Promise((resolve) => waiting.set(toolCall.tool_call_id, resolve));
    },
    answer(toolCallId: string, decision: "allow" | "deny"): boolean {
      const resolve = waiting.get(toolCallId);
      if (resolve === undefined) return false;
      waiting.delete(toolCallId);
      dispatch({ type: "decided", toolCallId });
      resolve(decision);
      return true;
    },
    clear(): void {
      for (const resolve of waiting.values()) resolve("deny");
      waiting.clear();
    },
  };
}

export type ApprovalDesk = ReturnType<typeof approvalDesk>;

/**
 * One run: the SDK's client over the try transport, one `record` per record as it arrives, then
 * `done` with the result. A refusal before the stream is `httpError`; a stream that breaks is
 * `ended`; aborting `signal` (Stop before the run named its Session, or leaving the tab) ends it
 * as stopped.
 */
export async function runTry(
  target: TryTarget,
  dispatch: (action: TryAction) => void,
  body: RunRequest,
  signal: AbortSignal,
  desk: ApprovalDesk = approvalDesk(dispatch),
): Promise<void> {
  dispatch({ type: "start" });
  const agent = `${target.projectId}/${target.agentId}`;
  const client = new AgentClient({ agent, transport: tryTransport(target.machineId ?? null) });
  const run = client.stream({
    input: body.input,
    ...(body.session_id !== undefined ? { sessionId: body.session_id } : {}),
    signal,
    onApproval: (toolCall) => desk.ask(toolCall),
  });
  run.session.then(
    (sessionId) => dispatch({ type: "session", sessionId, atMs: Date.now() }),
    () => {},
  );
  try {
    for await (const record of run) dispatch({ type: "record", record });
    dispatch({ type: "done", result: await run.result(), atMs: Date.now() });
  } catch (err) {
    if (signal.aborted) dispatch({ type: "ended", stopped: true });
    else if (err instanceof AmspHttpError) {
      dispatch({ type: "httpError", status: err.status, code: err.code, message: err.message });
    } else dispatch({ type: "ended" });
  } finally {
    desk.clear();
  }
}

/**
 * Stop: once the run has named its Session, the Session's abort route — the stream stays open and
 * ends with [DONE], its records saying the run was aborted; before that, the request itself is
 * aborted.
 */
export async function stopTry(
  state: TryState,
  controller: AbortController | null,
  /** The machine the run's Session is on (null: this server): the run named no route for it. */
  machineId: string | null = null,
): Promise<void> {
  if (state.startedAtMs !== null && state.sessionId !== null) {
    await api.postAbort(state.sessionId, machineId);
    return;
  }
  controller?.abort();
}
