/**
 * The /amsp player's two panes as functions of how many steps of a run have arrived: the stream
 * pane is one `stepLine` per step, the assembled pane is `foldRun` over the first `count`. Pure, so
 * the finished state, every step of the replay and the tests read the same code.
 *
 * The fold reads a run the way a client of the protocol does:
 * - fragments open an item and grow it; the complete record closes it with its own content, never
 *   compared with the fragments joined (two renderings of one message; only the complete one is
 *   stored);
 * - a tool's output belongs to its call's Request even when it completes after `request_end`;
 * - at `[DONE]` the outcome is read from the records (`runOutcome`, PRFC-0021's `RunResult` rule):
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
  /** The Request it belongs to (a tool's output: its call's); 0 before the run's first. */
  request: number;
}

export interface ReplayRequest {
  index: number;
  thinkingLevel: ThinkingLevel | null;
}

/** A run's outcome, and the facts in the records it was read from. */
export interface RunOutcome {
  status: StopReason;
  /** `internal` for a run whose last `task_begin` was never closed; else the terminal record's. */
  errorCode?: string;
  /** Every `task_begin` has its `task_end`. */
  closed: boolean;
  aborted: boolean;
  /** The main Session's last `request_end`, and its last assistant text, as they ended. */
  lastRequestEnd: StopReason | null;
  finalText: StopReason | null;
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
   * no Request completed (an interrupted Request reports none).
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
 * A finished run's outcome, read from its records in PRFC-0021's order: an unclosed `task_begin`
 * is a server failure; else an `abort`; else the last terminal `request_end` / `compaction_end`
 * (not completed, not to be retried); else a fatal final assistant text; else completed.
 */
export function runOutcome(records: readonly AmspRecord[]): RunOutcome {
  const main = records.filter((record) => record.origin === undefined);
  let open = 0;
  let aborted = false;
  let terminal: { status: StopReason; errorCode?: string } | null = null;
  let lastRequestEnd: StopReason | null = null;
  let finalText: StopReason | null = null;
  for (const record of main) {
    if (record.type === "event_msg") {
      const p = record.payload;
      if (p.type === "task_begin") open += 1;
      else if (p.type === "task_end") open = Math.max(0, open - 1);
      else if (p.type === "abort") aborted = true;
      else if (p.type === "request_end" || p.type === "compaction_end") {
        const end = p as { status: StopReason; error_code?: string; retry_in_ms?: number };
        if (p.type === "request_end") lastRequestEnd = end.status;
        if (end.status !== "completed" && end.retry_in_ms === undefined) {
          terminal = {
            status: end.status,
            ...(end.error_code !== undefined ? { errorCode: end.error_code } : {}),
          };
        }
      }
    } else if (
      record.type === "model_msg" &&
      record.payload.type === "text" &&
      record.payload.role === "assistant"
    ) {
      finalText = record.payload.stop_reason ?? "completed";
    }
  }
  const facts = { closed: open === 0, aborted, lastRequestEnd, finalText };
  if (open > 0) return { status: "fatal", errorCode: "internal", ...facts };
  if (aborted) return { status: "aborted", ...facts };
  if (terminal !== null) return { ...terminal, ...facts };
  if (finalText === "fatal") return { status: "fatal", ...facts };
  return { status: "completed", ...facts };
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
  const byKey = (key: string) => items.find((item) => item.key === key);
  /** The open text or thinking of this role, which a fragment grows and a complete record closes. */
  const openProse = (kind: ItemKind, role: ReplayItem["role"]) =>
    items.findLast((item) => item.open && item.kind === kind && item.role === role);
  const callRequest = (callId: string) => byKey(`call:${callId}`)?.request ?? current();

  /** A fragment: opens the item on its first piece, grows it with every delta. */
  const grow = (
    kind: ItemKind,
    role: ReplayItem["role"],
    key: string | null,
    piece: string,
    extra: { name?: string; callId?: string },
  ) => {
    const found = key === null ? openProse(kind, role) : byKey(key);
    if (found !== undefined) {
      // A fragment after its complete record adds nothing.
      if (!found.open) return;
      found.body += piece;
      if (extra.name) found.name = extra.name;
      return;
    }
    items.push({
      key: key ?? `${kind}:${role}:${items.length}`,
      kind,
      role,
      body: piece,
      open: true,
      request: extra.callId !== undefined ? callRequest(extra.callId) : current(),
      ...(extra.name ? { name: extra.name } : {}),
    });
  };

  /** A complete record: closes its open item with its own content, or stands as a new one. */
  const complete = (
    kind: ItemKind,
    role: ReplayItem["role"],
    key: string | null,
    body: string,
    extra: { name?: string; callId?: string },
  ) => {
    const found = key === null ? openProse(kind, role) : byKey(key);
    if (found !== undefined) {
      found.body = body;
      found.open = false;
      if (extra.name) found.name = extra.name;
      return;
    }
    items.push({
      key: key ?? `${kind}:${role}:${items.length}`,
      kind,
      role,
      body,
      open: false,
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
          if (p.event_type !== "stop") grow("text", p.role, null, p.text, {});
          break;
        case "partial_thinking":
          if (p.event_type !== "stop") grow("thinking", p.role, null, p.thinking, {});
          break;
        case "partial_tool_call":
          if (p.event_type !== "stop")
            grow("tool_call", p.role, `call:${p.tool_call_id}`, p.arguments, { name: p.name });
          break;
        case "partial_tool_call_output":
          if (p.event_type !== "stop")
            grow("tool_call_output", p.role, `output:${p.tool_call_id}`, p.output, {
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
        // A heartbeat or a resync notice: it adds nothing to the run.
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
  /** One line of the step's content, cut short. */
  preview: string;
}

/** A preview wraps in its column; past this it is cut, so a row stays within three lines. */
const PREVIEW_CHARS = 48;

const cut = (text: string) =>
  text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS - 1)}…` : text;

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
    preview: cut(preview),
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
        return line(p.type, quote(p.output));
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
    preview: cut(preview),
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

/** The pace of the replay: the recorded gap between two steps, held within these bounds. */
export const FIRST_STEP_MS = 300;
export const MIN_STEP_MS = 120;
export const MAX_STEP_MS = 900;

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

/** A streamed message: from its `start` fragment to its complete record. */
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
 * `task_end`, each Request from `request_begin` to `request_end`, each message from its `start`
 * fragment to its complete record. A message that arrives complete with no fragments (the echoed
 * input) spans no time and is left out; a run with no closed Task has no spans.
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
  const streaming = new Map<string, number>();
  let request: number | null = null;
  for (const record of main) {
    if (record.type === "event_msg") {
      if (record.payload.type === "request_begin") request = at(record);
      else if (record.payload.type === "request_end" && request !== null) {
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
          if (p.event_type === "start") streaming.set(streamKey(p), at(record));
          break;
        case "text":
        case "thinking":
        case "tool_call":
        case "tool_call_output": {
          const begin = streaming.get(streamKey(p));
          if (begin === undefined) break;
          streaming.delete(streamKey(p));
          messages.push({ kind: p.type, begin, end: at(record) });
          break;
        }
      }
    }
  }
  return { task: { begin: 0, end: at(last) }, requests, messages };
}

/** When a tool's output completed after its call's `request_end`: how long after, in ms. */
export function resultAfterRequestEnd(records: readonly AmspRecord[]): number | null {
  const output = records.findIndex((record) => kindOf(record) === "tool_call_output");
  if (output < 0) return null;
  const end = records.slice(0, output).findLastIndex((record) => kindOf(record) === "request_end");
  if (end < 0) return null;
  return Date.parse(records[output]!.timestamp) - Date.parse(records[end]!.timestamp);
}
