/**
 * The API tab's Try it, without React: the state of one panel, the reducer that folds a run's
 * stream into it, and the async driver that feeds it.
 *
 * A run is the Agent API's own run, sent through the owner's try route (`tryAgentApi`) and read
 * with the SDK's `readSse`, so the panel sees exactly the `data:` payloads a program would. Each
 * payload is kept verbatim (the raw view prints them back) and becomes one log entry, except that
 * consecutive fragments of one item — `*.delta` events of one type, one tool call, one origin —
 * fold into a single entry that counts them. `run.done` gives the result line and the answer,
 * folded by the SDK's `RunCollector` as a program's `result()` would be.
 *
 * The Session id that `run.started` names stays after the run, so the next run continues the
 * conversation, the way a program passes `session_id`; New conversation forgets it.
 */
import { readSse, RunCollector } from "@prismshadow/amsp";
import type { AmspEvent, RunRequest, RunResult } from "@prismshadow/amsp";
import { ApiError } from "../../api/client";
import * as api from "../../api/endpoints";

/** Where a summary is cut, so one long argument or output line does not take the log. */
const CUT = 120;

const cut = (text: string): string => (text.length > CUT ? `${text.slice(0, CUT)}…` : text);

/** One line of the event log: one event, or a run of fragments of one item. */
export interface TryEntry {
  /** Stable within a run: the entry's position. */
  id: number;
  /** The event's `type`; `?` for a payload that is not an AMSP event. */
  type: string;
  summary: string;
  /** How many events the entry stands for: 1, or the number of fragments folded into it. */
  count: number;
  /** The payloads it stands for, exactly as `readSse` yielded them. */
  raw: string[];
  tone?: "danger";
  /** On `approval.requested`: the call it asks about, and whether an answer is still open. */
  approval?: { toolCallId: string; pending: boolean };
  /** On a fragment entry: the item its fragments belong to, and their accumulated length. */
  item?: { key: string; chars: number };
}

/** The key fields of an event, on one line: what the log shows after the type. */
export function summarizeEvent(ev: AmspEvent): string {
  switch (ev.type) {
    case "run.started":
      return `session_id=${ev.session_id}`;
    case "context.opened":
      return `${ev.provider}/${ev.model_id}`;
    case "request.started":
      return `#${ev.request}`;
    case "request.done":
      return ev.usage === null ? ev.status : `${ev.status} total=${ev.usage.total}`;
    case "tool_call.done":
      return `${ev.name} ${cut(ev.arguments)}`;
    case "tool_result.done":
      return `${ev.stop_reason} ${cut(ev.output.trimStart().split("\n")[0] ?? "")}`.trimEnd();
    case "text.done":
      return cut(ev.text.replace(/\s+/g, " ").trim());
    case "thinking.done":
      return `(${ev.thinking.length} chars)`;
    case "approval.requested":
      return ev.tool_call.name;
    case "approval.decided":
      return ev.decision;
    case "compaction.started":
    case "compaction.done":
      return ev.reason;
    case "run.done":
      return [
        ev.status,
        `requests=${ev.requests}`,
        `total=${ev.usage.total}`,
        ...(ev.error !== undefined ? [ev.error.code] : []),
      ].join(" ");
    default: {
      const rest = Object.fromEntries(
        Object.entries(ev).filter(([field]) => field !== "type" && field !== "at"),
      );
      return cut(JSON.stringify(rest));
    }
  }
}

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

/** A fragment's item and its length; null for anything that is not a fragment. */
function fragmentOf(ev: AmspEvent): { key: string; chars: number } | null {
  if (!ev.type.endsWith(".delta")) return null;
  const fields = ev as unknown as Record<string, unknown>;
  const text = [fields.text, fields.thinking, fields.arguments, fields.output].find(
    (v): v is string => typeof v === "string",
  );
  const callId = typeof fields.tool_call_id === "string" ? fields.tool_call_id : "";
  return { key: `${ev.type} ${callId} ${(ev.origin ?? []).join("/")}`, chars: text?.length ?? 0 };
}

/**
 * The log with one more payload: a fragment of the same item as the last entry folds into it
 * (one more in its count, its length added), anything else is a new entry. Every payload is
 * kept as it came.
 */
export function appendEvent(entries: readonly TryEntry[], payload: string): TryEntry[] {
  const id = entries.length;
  const ev = parseEvent(payload);
  if (ev === null)
    return [...entries, { id, type: "?", summary: cut(payload), count: 1, raw: [payload] }];
  const fragment = fragmentOf(ev);
  if (fragment !== null) {
    const last = entries.at(-1);
    if (last?.item !== undefined && last.item.key === fragment.key) {
      const chars = last.item.chars + fragment.chars;
      return [
        ...entries.slice(0, -1),
        {
          ...last,
          summary: `(${chars} chars)`,
          count: last.count + 1,
          raw: [...last.raw, payload],
          item: { key: fragment.key, chars },
        },
      ];
    }
    return [
      ...entries,
      {
        id,
        type: ev.type,
        summary: `(${fragment.chars} chars)`,
        count: 1,
        raw: [payload],
        item: fragment,
      },
    ];
  }
  return [
    ...entries,
    {
      id,
      type: ev.type,
      summary: summarizeEvent(ev),
      count: 1,
      raw: [payload],
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

export type TryView = "events" | "raw";

export interface TryState {
  input: string;
  running: boolean;
  /** The Session the last run named: the next run continues it. */
  sessionId: string | null;
  /** The current run's `run.started` time; null until it arrives, so Stop knows whom to ask. */
  startedAt: string | null;
  entries: TryEntry[];
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
    entries: [],
    view: "events",
    result: null,
    error: null,
    broken: false,
    closed: false,
  };
}

/** The entries with the answer to `toolCallId` (or, without one, to every call) no longer open. */
function settle(entries: TryEntry[], toolCallId?: string): TryEntry[] {
  return entries.map((e) =>
    e.approval?.pending === true &&
    (toolCallId === undefined || e.approval.toolCallId === toolCallId)
      ? { ...e, approval: { ...e.approval, pending: false } }
      : e,
  );
}

/** What the run comes to, folded from every payload it sent; null when the stream never said. */
function resultOf(entries: readonly TryEntry[], doneAt: string, startedAt: string | null) {
  const collector = new RunCollector();
  for (const entry of entries) {
    for (const payload of entry.raw) {
      const ev = parseEvent(payload);
      if (ev !== null) collector.add(ev);
    }
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
        entries: [],
        result: null,
        error: null,
        broken: false,
        closed: false,
      };
    case "payload": {
      if (action.data === "[DONE]") return { ...state, closed: true };
      const entries = appendEvent(state.entries, action.data);
      const ev = parseEvent(action.data);
      if (ev?.type === "run.started") {
        return { ...state, entries, sessionId: ev.session_id, startedAt: ev.at };
      }
      if (ev?.type === "approval.decided") {
        return { ...state, entries: settle(entries, ev.tool_call_id) };
      }
      if (ev?.type === "run.done") {
        // Finished: the input clears for a follow-up on the same Session.
        return {
          ...state,
          entries: settle(entries),
          result: resultOf(entries, ev.at, state.startedAt),
          input: "",
        };
      }
      return { ...state, entries };
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
        entries: settle(state.entries),
        broken: action.stopped !== true && state.result === null && state.error === null,
      };
    case "view":
      return { ...state, view: action.view };
    case "decided":
      return { ...state, entries: settle(state.entries, action.toolCallId) };
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
export function rawLines(state: Pick<TryState, "entries" | "closed">): string[] {
  const lines = state.entries.flatMap((e) => e.raw.map((payload) => `data: ${payload}`));
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
