/**
 * What a summarize compaction carries into the next context, read off the closing Trace file:
 * pure functions the live engine and Trace replay share, so a restart rebuilds from the same file
 * the opening the live context got.
 */
import { isCompleteModelMessage, isEventMessage } from "@prismshadow/amsp/records";
import type {
  AmspRecord,
  CompactionEndPayload,
  RequestEndPayload,
  TextPayload,
  ToolCallOutputPayload,
  ToolCallPayload,
} from "@prismshadow/amsp/records";
import {
  MARKER_TAGS,
  buildContextSummaryText,
  markerClose,
  markerOpen,
  transcribeRequestError,
  transcribeText,
  transcribeToolCall,
  transcribeToolCallOutput,
  transcribeUserInput,
} from "@prismshadow/amsp/markers";

/** User messages quoted after the context's first one, and the characters each is cut to. */
const LAST_USER_MESSAGES = 3;
const USER_MESSAGE_CHARS = 1500;
/** The last completed turn's calls quoted, the latest ones. */
const LAST_TURN_CALLS = 4;
/** Characters every other quote is cut to: the error, the turn's text, each argument and output. */
const QUOTE_CHARS = 500;
/** What a placeholder with nothing to quote reads. */
const NOT_RECORDED = "(not recorded)";
/** What a blank template stands for: the quoted data alone. */
const BLANK_TEMPLATE = "{{ERROR}}\n{{USER_MESSAGES}}\n{{LAST_TURN}}\n{{TRACE_PATH}}";
const PLACEHOLDERS = /\{\{(ERROR|USER_MESSAGES|LAST_TURN|TRACE_PATH)\}\}/g;

const typeOf = (msg: AmspRecord): string | undefined => (msg.payload as { type?: string }).type;

const isEvent = (msg: AmspRecord, type: string): boolean =>
  isEventMessage(msg) && typeOf(msg) === type;

/** A record of the Session itself, not one relayed from a child Session. */
const isMainSession = (msg: AmspRecord): boolean => (msg.origin?.length ?? 0) === 0;

/** Index of the file's last `compaction_begin`, or -1. */
function lastCompactionBegin(file: readonly AmspRecord[]): number {
  for (let i = file.length - 1; i >= 0; i--) {
    if (isEvent(file[i]!, "compaction_begin")) return i;
  }
  return -1;
}

/**
 * The records of the file's last compaction span, from its final `compaction_begin` through the
 * `compaction_end` that closes it (to the file's end while none does; the whole file when it
 * holds no compaction): neither a request from before it nor a record written after its end
 * (Task records, the next Task's first input) can stand in for its own.
 */
export function closingSpan(file: AmspRecord[]): AmspRecord[] {
  const begin = lastCompactionBegin(file);
  if (begin === -1) return file;
  for (let i = begin + 1; i < file.length; i++) {
    if (isEvent(file[i]!, "compaction_end")) return file.slice(begin, i + 1);
  }
  return file.slice(begin);
}

/** The assistant text of the span's last completed request, "" when none completed. */
export function lastCompletedReply(span: AmspRecord[]): string {
  const turn = lastCompletedTurn(span.filter(isMainSession));
  return turn === null ? "" : replyText(turn);
}

// Transitional until the round-5 cleanup commit, for the engine: no opening lists calls any more.
export interface SpanCall {
  call: AmspRecord<ToolCallPayload>;
  output?: AmspRecord<ToolCallOutputPayload>;
}
export function compactionCallLines(calls: readonly SpanCall[]): string[] {
  return calls.flatMap(({ call, output }) => callPairLines(call, output));
}

/**
 * The note that opens the next context when a compaction ends without a summary: `template`
 * (`compaction.handoff_note`; blank: the four placeholders one per line) with `{{ERROR}}`, the
 * closing `compaction_end`'s error pair; `{{USER_MESSAGES}}`, the context's first user message
 * and its last three outside every compaction span; `{{LAST_TURN}}`, the last completed
 * request's text and its last four calls with their outputs; `{{TRACE_PATH}}`. Each is read off
 * the file up to the span's end, so live and replay build the same note; an empty one reads
 * `(not recorded)`. `opts.shell` is ignored until the round-5 cleanup commit.
 */
export function buildCompactionHandoff(
  file: AmspRecord[],
  opts: { tracePath?: string; shell?: string; template?: string },
): string {
  const main = file.filter(isMainSession);
  const begin = lastCompactionBegin(main);
  const before = begin === -1 ? main : main.slice(0, begin);
  const span = begin === -1 ? [] : closingSpan(main);
  const context = outsideCompactionSpans(before);
  const turn = lastCompletedTurn(context);
  const values: Record<string, string> = {
    ERROR: errorLine(span),
    USER_MESSAGES: userLines(context).join("\n"),
    LAST_TURN: turn === null ? "" : turnLines(turn, outputsById([...before, ...span])).join("\n"),
    TRACE_PATH: opts.tracePath ?? "",
  };
  const template =
    opts.template !== undefined && opts.template.trim() !== "" ? opts.template : BLANK_TEMPLATE;
  // One pass: a quote that spells a placeholder stays as written.
  return buildContextSummaryText(
    template.replace(PLACEHOLDERS, (_, key: string) => values[key] || NOT_RECORDED),
  );
}

/** The `[request_error]` line of the span's own `compaction_end`, "" when it has no error pair. */
function errorLine(span: readonly AmspRecord[]): string {
  const end = span.at(-1);
  if (end === undefined || !isEvent(end, "compaction_end")) return "";
  const p = end.payload as Partial<CompactionEndPayload>;
  if (p.error_code === undefined && p.error_message === undefined) return "";
  return transcribeRequestError(p.error_code, headOf(p.error_message ?? "", QUOTE_CHARS));
}

/** The records outside every compaction span (a span's begin and end are its own). */
function outsideCompactionSpans(records: readonly AmspRecord[]): AmspRecord[] {
  const out: AmspRecord[] = [];
  let inSpan = false;
  for (const msg of records) {
    if (isEvent(msg, "compaction_begin")) inSpan = true;
    else if (isEvent(msg, "compaction_end")) inSpan = false;
    else if (!inSpan) out.push(msg);
  }
  return out;
}

/** `[context_summary]` tag lines, both spellings: what a quoted user message loses. */
const SUMMARY_TAG_LINES: ReadonlySet<string> = new Set([
  markerOpen(MARKER_TAGS.contextSummary),
  markerClose(MARKER_TAGS.contextSummary),
  `<${MARKER_TAGS.contextSummary}>`,
  `</${MARKER_TAGS.contextSummary}>`,
]);

/** The first user message and the last three, "…[N messages left out]…" between. */
function userLines(context: readonly AmspRecord[]): string[] {
  const users = context.flatMap((msg) => {
    if (!isCompleteModelMessage(msg)) return [];
    const p = msg.payload as Partial<TextPayload>;
    if (p.type !== "text" || p.role !== "user" || typeof p.text !== "string") return [];
    const text = p.text
      .split("\n")
      .filter((line) => !SUMMARY_TAG_LINES.has(line.trim()))
      .join("\n");
    return text.trim() === "" ? [] : [text];
  });
  if (users.length === 0) return [];
  const last = users.slice(1).slice(-LAST_USER_MESSAGES);
  const leftOut = users.length - 1 - last.length;
  const quote = (text: string): string => transcribeUserInput(headOf(text, USER_MESSAGE_CHARS));
  return [
    quote(users[0]!),
    ...(leftOut > 0 ? [`  …[${count(leftOut, "message")} left out]…`] : []),
    ...last.map(quote),
  ];
}

/** The records of the last completed request (between its begin and its end), or null when none completed. */
function lastCompletedTurn(records: readonly AmspRecord[]): AmspRecord[] | null {
  for (let end = records.length - 1; end >= 0; end--) {
    const msg = records[end]!;
    if (!isEvent(msg, "request_end")) continue;
    if ((msg.payload as RequestEndPayload).status !== "completed") continue;
    let begin = end - 1;
    while (begin >= 0 && !isEvent(records[begin]!, "request_begin")) begin--;
    return records.slice(begin + 1, end);
  }
  return null;
}

/** The assistant text a request wrote, its complete text records concatenated. */
function replyText(turn: readonly AmspRecord[]): string {
  let text = "";
  for (const msg of turn) {
    if (!isCompleteModelMessage(msg)) continue;
    const p = msg.payload as Partial<TextPayload>;
    if (p.type === "text" && p.role === "assistant" && p.text) text += p.text;
  }
  return text;
}

/** The turn's `[text]` line, then its last four calls, each with its output's line if any. */
function turnLines(
  turn: readonly AmspRecord[],
  outputs: ReadonlyMap<string, AmspRecord<ToolCallOutputPayload>>,
): string[] {
  const text = replyText(turn);
  const calls = turn
    .filter((msg) => isCompleteModelMessage(msg) && typeOf(msg) === "tool_call")
    .slice(-LAST_TURN_CALLS) as AmspRecord<ToolCallPayload>[];
  return [
    ...(text.trim() !== "" ? [transcribeText(headOf(text, QUOTE_CHARS))] : []),
    ...calls.flatMap((call) => callPairLines(call, outputs.get(call.payload.tool_call_id))),
  ];
}

/** A call's line and, when it was answered, its output's line (text only: images never cross). */
function callPairLines(
  call: AmspRecord<ToolCallPayload>,
  output: AmspRecord<ToolCallOutputPayload> | undefined,
): string[] {
  const c = call.payload as Partial<ToolCallPayload>;
  const id = c.tool_call_id ?? "";
  const lines = [transcribeToolCall(c.name ?? "", id, headOf(c.arguments ?? "", QUOTE_CHARS))];
  if (output !== undefined) {
    const o = output.payload as Partial<ToolCallOutputPayload>;
    lines.push(
      transcribeToolCallOutput(id, o.status ?? "completed", headOf(o.output ?? "", QUOTE_CHARS)),
    );
  }
  return lines;
}

/** Every tool output among the records, by the id of the call it answers (the first one written). */
function outputsById(
  records: readonly AmspRecord[],
): Map<string, AmspRecord<ToolCallOutputPayload>> {
  const outputs = new Map<string, AmspRecord<ToolCallOutputPayload>>();
  for (const msg of records) {
    if (!isCompleteModelMessage(msg)) continue;
    const p = msg.payload as { type?: string; tool_call_id?: string };
    if (p.type === "tool_call_output" && p.tool_call_id && !outputs.has(p.tool_call_id)) {
      outputs.set(p.tool_call_id, msg as AmspRecord<ToolCallOutputPayload>);
    }
  }
  return outputs;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** `text` cut to its first `cap` characters, marked with how many were left out. */
function headOf(text: string, cap: number): string {
  if (text.length <= cap) return text;
  // Back one when the cut would split a surrogate pair.
  const code = text.charCodeAt(cap - 1);
  const head = text.slice(0, code >= 0xd800 && code <= 0xdbff ? cap - 1 : cap);
  return `${head} …[${count(text.length - head.length, "character")} left out]`;
}
