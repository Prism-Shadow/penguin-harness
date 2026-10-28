/**
 * The /amsp player's two panes as functions of how many steps of a run have arrived: the stream
 * pane is one `stepLine` per step, the assembled pane is `foldRun` over the first `count`. Pure, so
 * the finished state, every step of the replay and the tests read the same code.
 *
 * The fold reads a run the way a client of the protocol does:
 * - fragments open an item and grow it; the complete record closes it with its own content, never
 *   compared with the fragments joined (two renderings of one message; only the complete one is
 *   stored), an interrupted item's included;
 * - a tool's output belongs to its call's Request even when it completes after `request_end`;
 * - at `[DONE]` the outcome is read from the records (`runOutcome`, the SDK's `RunResult` rule):
 *   `task_end` carries no status.
 *
 * Page-specific on purpose: the SDK's `AgentClient` and `SessionReader` and the Web App's view
 * model do this for real, and none of them is a dependency of the landing site.
 */
import type {
  AmspRecord,
  ModelPayload,
  StopReason,
  StreamPhase,
  ThinkingLevel,
  TokenCounts,
} from "./amsp-protocol";
import type { RunStep } from "./amsp-demo";
import { isStored } from "./amsp-vocabulary";

export type ItemKind = "text" | "thinking" | "tool_call" | "tool_call_output";

export interface ReplayItem {
  key: string;
  kind: ItemKind;
  role: "user" | "assistant";
  /** A tool call's name. */
  name?: string;
  /** The text, thinking, arguments or output: the fragments so far, then the complete record's own. */
  body: string;
  /** Fragments have arrived and the complete record has not. */
  open: boolean;
  /** Its `stop` fragment arrived: no more fragments follow. */
  stopped: boolean;
  /** The Request it belongs to (a tool's output: its call's); 0 before the run's first. */
  request: number;
}

export interface ReplayRequest {
  index: number;
  thinkingLevel: ThinkingLevel | null;
}

/** A run's outcome, read from its records. */
export interface RunOutcome {
  status: StopReason;
  /** `internal` for a run that did not reach its end; else the abort's or the terminal record's. */
  errorCode?: string;
}

export interface ReplayState {
  items: ReplayItem[];
  requests: ReplayRequest[];
  /** The model, from `session_meta`: a Session's first message only. */
  model: string | null;
  /** Once `[DONE]` has arrived. */
  outcome: RunOutcome | null;
  /**
   * The run's usage, summed over its `token_usage` records, once `[DONE]` has arrived; none when
   * no record reported usage.
   */
  usage: TokenCounts | null;
  /** From the first `task_begin` to the last `task_end`. */
  elapsedMs: number | null;
  done: boolean;
}

const ZERO: TokenCounts = { cache_read: 0, cache_write: 0, output: 0, total: 0 };

const sum = (a: TokenCounts, b: TokenCounts): TokenCounts => ({
  cache_read: a.cache_read + b.cache_read,
  cache_write: a.cache_write + b.cache_write,
  output: a.output + b.output,
  total: a.total + b.total,
});

const kindOf = (record: AmspRecord) =>
  record.type === "session_meta" ? "session_meta" : record.payload.type;

/**
 * A finished run's outcome, read from its records in the SDK's order (`RunResult`): a run whose
 * last `task_begin` has no `task_end`, or that began none, did not reach its end (`fatal`,
 * `internal`); else an `abort`, with its cause; else the last `request_end` / `compaction_end`
 * that did not complete and plans no retry, unless a later Request went on; else completed.
 */
export function runOutcome(records: readonly AmspRecord[]): RunOutcome {
  const main = records.filter((record) => record.origin === undefined);
  let task: "none" | "open" | "closed" = "none";
  let abort: { errorCode?: string } | null = null;
  let terminal: { status: StopReason; errorCode?: string } | null = null;
  for (const record of main) {
    if (record.type !== "event_msg") continue;
    const p = record.payload;
    switch (p.type) {
      case "task_begin":
        task = "open";
        break;
      case "task_end":
        task = "closed";
        break;
      case "abort":
        abort = { errorCode: p.error_code ?? "user_abort" };
        break;
      case "request_begin":
        // The run went on: an earlier failure was not its end.
        terminal = null;
        break;
      case "request_end":
      case "compaction_end":
        if (p.status !== "completed" && p.retry_in_ms === undefined) {
          terminal = {
            status: p.status,
            ...(p.error_code !== undefined ? { errorCode: p.error_code } : {}),
          };
        }
        break;
    }
  }
  if (task !== "closed") return { status: "fatal", errorCode: "internal" };
  if (abort !== null) return { status: "aborted", ...abort };
  if (terminal !== null) return terminal;
  return { status: "completed" };
}

/** The panes after the first `count` steps of a run. */
export function foldRun(steps: readonly RunStep[], count: number): ReplayState {
  const items: ReplayItem[] = [];
  const requests: ReplayRequest[] = [];
  const records: AmspRecord[] = [];
  let usage: TokenCounts | null = null;
  let model: string | null = null;
  let done = false;

  const current = () => requests.length;
  const byKey = (key: string) => items.findLast((item) => item.key === key);
  /** The text or thinking of this role still waiting for its complete record. */
  const openProse = (kind: ItemKind, role: ReplayItem["role"]) =>
    items.findLast((item) => item.open && item.kind === kind && item.role === role);
  const callRequest = (callId: string) => byKey(`call:${callId}`)?.request ?? current();
  const fresh = (kind: ItemKind, role: ReplayItem["role"], key: string | null) =>
    key ?? `${kind}:${role}:${items.length}`;

  /** A fragment: `start` opens the item, a `delta` grows it, `stop` ends its fragments. */
  const fragment = (
    kind: ItemKind,
    role: ReplayItem["role"],
    key: string | null,
    phase: StreamPhase,
    piece: string,
    extra: { name?: string; callId?: string },
  ) => {
    const found = key === null ? openProse(kind, role) : byKey(key);
    if (found !== undefined && found.open && !found.stopped) {
      if (phase === "stop") found.stopped = true;
      found.body += piece;
      if (extra.name) found.name = extra.name;
      return;
    }
    if (phase === "stop") return;
    items.push({
      key: fresh(kind, role, key),
      kind,
      role,
      body: piece,
      open: true,
      stopped: false,
      request: extra.callId !== undefined ? callRequest(extra.callId) : current(),
      ...(extra.name ? { name: extra.name } : {}),
    });
  };

  /** A complete record: closes its item with its own content, or stands as a new one. */
  const complete = (
    kind: ItemKind,
    role: ReplayItem["role"],
    key: string | null,
    body: string,
    extra: { name?: string; callId?: string },
  ) => {
    const found = key === null ? openProse(kind, role) : byKey(key);
    if (found !== undefined && found.open) {
      found.body = body;
      found.open = false;
      found.stopped = true;
      if (extra.name) found.name = extra.name;
      return;
    }
    items.push({
      key: fresh(kind, role, key),
      kind,
      role,
      body,
      open: false,
      stopped: true,
      request: extra.callId !== undefined ? callRequest(extra.callId) : current(),
      ...(extra.name ? { name: extra.name } : {}),
    });
  };

  const fold = (record: AmspRecord) => {
    records.push(record);
    if (record.type === "session_meta") {
      model = `${record.payload.provider}/${record.payload.model_id}`;
      return;
    }
    if (record.type === "model_msg") {
      const p = record.payload;
      switch (p.type) {
        case "partial_text":
          fragment("text", p.role, null, p.event_type, p.text, {});
          break;
        case "partial_thinking":
          fragment("thinking", p.role, null, p.event_type, p.thinking, {});
          break;
        case "partial_tool_call":
          fragment("tool_call", p.role, `call:${p.tool_call_id}`, p.event_type, p.arguments, {
            name: p.name,
          });
          break;
        case "partial_tool_call_output":
          fragment("tool_call_output", p.role, `output:${p.tool_call_id}`, p.event_type, p.output, {
            callId: p.tool_call_id,
          });
          break;
        case "text":
          complete("text", p.role, null, p.text, {});
          break;
        case "thinking":
          complete("thinking", p.role, null, p.thinking, {});
          break;
        case "tool_call":
          complete("tool_call", p.role, `call:${p.tool_call_id}`, p.arguments, { name: p.name });
          break;
        case "tool_call_output":
          complete("tool_call_output", p.role, `output:${p.tool_call_id}`, p.output, {
            callId: p.tool_call_id,
          });
          break;
      }
      return;
    }
    const p = record.payload;
    switch (p.type) {
      case "request_begin":
        requests.push({ index: requests.length + 1, thinkingLevel: p.thinking_level ?? null });
        break;
      case "token_usage":
        usage = sum(usage ?? ZERO, p.request);
        break;
    }
  };

  for (const step of steps.slice(0, count)) {
    switch (step.kind) {
      case "control":
        // The heartbeat: it adds nothing to the run.
        break;
      case "record":
        fold(step.record);
        break;
      case "request":
        // Beside the stream: what it changes arrives as records.
        break;
      case "done":
        done = true;
        break;
    }
  }

  if (!done) {
    return { items, requests, model, outcome: null, usage: null, elapsedMs: null, done };
  }
  for (const item of items) item.open = false;
  const at = (type: string, last: boolean) => {
    const found = last
      ? records.findLast((record) => kindOf(record) === type)
      : records.find((record) => kindOf(record) === type);
    return found === undefined ? null : Date.parse(found.timestamp);
  };
  const begin = at("task_begin", false);
  const end = at("task_end", true);
  return {
    items,
    requests,
    model,
    outcome: runOutcome(records),
    usage,
    elapsedMs: begin !== null && end !== null ? end - begin : null,
    done,
  };
}

export interface StepLine {
  kind: RunStep["kind"];
  /** A record's envelope type, `event` for a control frame, a request's method, or `data`. */
  head: string;
  /** A record's `payload.type`, the frame's name, the request's path, or `[DONE]`. */
  name: string;
  /** A fragment's phase. */
  phase: StreamPhase | null;
  /** The Trace stores this record. */
  stored: boolean;
  /** The step's content on one line, whole: the pane shortens it to its column. */
  preview: string;
}

const quote = (text: string) => JSON.stringify(text);

/** A payload's fields beyond its `type`, as JSON: the preview of a kind this page does not read. */
function rest(payload: object): string {
  const { type: _type, ...fields } = payload as { type?: unknown };
  return Object.keys(fields).length > 0 ? JSON.stringify(fields) : "";
}

/** One record's row: its envelope, its kind, its phase and a preview. */
function recordLine(record: AmspRecord): StepLine {
  const line = (name: string, preview: string, phase: StreamPhase | null = null): StepLine => ({
    kind: "record",
    head: record.type,
    name,
    phase,
    stored: isStored(record.type, record.type === "session_meta" ? undefined : name),
    preview,
  });
  /** A fragment: its phase, then what it carries, if anything. */
  const fragment = (name: string, phase: StreamPhase, head: string, piece: string) =>
    line(name, [phase, head, piece === "" ? "" : quote(piece)].filter(Boolean).join(" "), phase);

  if (record.type === "session_meta") {
    const p = record.payload;
    return line("", `${p.provider}/${p.model_id} · ${p.source}`);
  }
  if (record.type === "model_msg") {
    const p = record.payload;
    switch (p.type) {
      case "partial_text":
        return fragment(p.type, p.event_type, "", p.text);
      case "partial_thinking":
        return fragment(p.type, p.event_type, "", p.thinking);
      case "partial_tool_call":
        return fragment(p.type, p.event_type, p.name, p.arguments);
      case "partial_tool_call_output":
        return fragment(p.type, p.event_type, "", p.output);
      case "text":
        return line(p.type, `${p.role} ${quote(p.text)}`);
      case "thinking":
        return line(p.type, quote(p.thinking));
      case "tool_call":
        return line(p.type, `${p.name} ${p.arguments}`);
      case "tool_call_output":
        return line(p.type, `${p.status} ${quote(p.output)}`);
      default:
        return line(p.type, rest(p));
    }
  }
  const p = record.payload;
  switch (p.type) {
    case "request_begin":
      return line(p.type, p.thinking_level ? `thinking_level ${p.thinking_level}` : "");
    case "request_end":
      return line(p.type, p.status);
    case "token_usage":
      return line(p.type, `request ${p.request.total} · session ${p.session.total}`);
    case "approval_decision":
      return line(p.type, `${p.decision} ${p.tool_call_id}`);
    case "tool_list_ready":
      return line(p.type, p.tools.map((tool) => tool.name).join(", "));
    default:
      return line(p.type, rest(p));
  }
}

/** One row of the stream pane. */
export function stepLine(step: RunStep): StepLine {
  const line = (head: string, name: string, preview = ""): StepLine => ({
    kind: step.kind,
    head,
    name,
    phase: null,
    stored: false,
    preview,
  });
  switch (step.kind) {
    case "record":
      return recordLine(step.record);
    case "control": {
      const { kind, ...data } = step.control;
      return line("event", kind, Object.values(data).join(" "));
    }
    case "request":
      return line(
        step.request.method,
        step.request.path.replace(/\/sessions\/[^/]+/, "…/sessions/:id"),
      );
    case "done":
      return line("data", "[DONE]");
  }
}

/**
 * The pace of the replay: each step waits its recorded gap, held within these bounds. Steps the
 * server sent together (a millisecond apart) arrive one by one, slowly enough to read each row;
 * a longer wait the run really had (the first token, a tool running) is kept up to the cap.
 */
export const FIRST_STEP_MS = 400;
export const MIN_STEP_MS = 400;
export const MAX_STEP_MS = 1200;

/** When a step happened: a record's timestamp, a request's time; frames carry none. */
const timeOf = (step: RunStep): number | null =>
  step.kind === "record"
    ? Date.parse(step.record.timestamp)
    : step.kind === "request"
      ? Date.parse(step.at)
      : null;

/** Milliseconds to wait before showing step i: its gap after step i − 1, clamped. */
export function stepDelays(steps: readonly RunStep[]): number[] {
  return steps.map((step, i) => {
    if (i === 0) return FIRST_STEP_MS;
    const now = timeOf(step);
    const before = timeOf(steps[i - 1]!);
    if (now === null || before === null) return MIN_STEP_MS;
    return Math.min(MAX_STEP_MS, Math.max(MIN_STEP_MS, now - before));
  });
}

/** A stretch of a run, in milliseconds since its first `task_begin`. */
export interface Span {
  begin: number;
  end: number;
}

/**
 * A streamed message: from the moment the one before it ended (its Request's `request_begin`, or
 * the previous message's complete record) to its own complete record, the wait for its first
 * fragment included.
 */
export interface MessageSpan extends Span {
  kind: ItemKind;
}

/** A run's three levels, longest first: the Task, its Requests, the messages they stream. */
export interface RunSpans {
  task: Span;
  requests: Span[];
  messages: MessageSpan[];
}

/** A message or one of its fragments: the key that pairs the two (the call id, else the role). */
function streamKey(payload: Extract<ModelPayload, { type: ItemKind | `partial_${ItemKind}` }>) {
  const id = "tool_call_id" in payload ? payload.tool_call_id : payload.role;
  return `${payload.type.replace(/^partial_/, "")}:${id}`;
}

/**
 * The main Session's spans in a finished run: the Task from its first `task_begin` to its last
 * `task_end`, each Request from `request_begin` to `request_end`, and each streamed message from
 * where the one before it ended to its complete record, so the messages of a Request tile it and a
 * tool's output runs on from its call. A message that arrives complete with no fragments (the
 * echoed input) is not a span; a run with no closed Task has no spans.
 */
export function runSpans(records: readonly AmspRecord[]): RunSpans | null {
  const main = records.filter((record) => record.origin === undefined);
  const first = main.find((record) => kindOf(record) === "task_begin");
  const last = main.findLast((record) => kindOf(record) === "task_end");
  if (first === undefined || last === undefined) return null;
  const zero = Date.parse(first.timestamp);
  const at = (record: AmspRecord) => Date.parse(record.timestamp) - zero;

  const requests: Span[] = [];
  const messages: MessageSpan[] = [];
  const streaming = new Set<string>();
  let request: number | null = null;
  /** Where the next message's span starts: the last `request_begin` or complete message. */
  let boundary = 0;
  for (const record of main) {
    if (record.type === "event_msg") {
      if (record.payload.type === "request_begin") {
        request = at(record);
        boundary = request;
      } else if (record.payload.type === "request_end" && request !== null) {
        requests.push({ begin: request, end: at(record) });
        request = null;
      }
    } else if (record.type === "model_msg") {
      const p = record.payload;
      switch (p.type) {
        case "partial_text":
        case "partial_thinking":
        case "partial_tool_call":
        case "partial_tool_call_output":
          if (p.event_type === "start") streaming.add(streamKey(p));
          break;
        case "text":
        case "thinking":
        case "tool_call":
        case "tool_call_output": {
          if (!streaming.delete(streamKey(p))) break;
          messages.push({ kind: p.type, begin: boundary, end: at(record) });
          boundary = at(record);
          break;
        }
      }
    }
  }
  return { task: { begin: 0, end: at(last) }, requests, messages };
}
