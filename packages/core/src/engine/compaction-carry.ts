/**
 * What a summarize compaction carries into the next context, read off the records of its span:
 * the pure functions the live engine and Trace replay share, so the opening a context gets live
 * and the one a restart rebuilds from the same file are the same text.
 *
 * - `closingSpan` cuts a file's last compaction out of it; `spanRequests` / `spanCalls` read its
 *   requests and its tool calls back the way the engine ran them (the engine fills the same
 *   shapes from what it ran).
 * - `pickSalvage` chooses the summary a reply cut off before its end still holds: the middle
 *   rung of the ladder, between a full summary and the hand-off note.
 * - `compactionCallLines` transcribes the compaction's calls for the next context, under a
 *   summary or inside the note: the harness's record of which writes really happened.
 * - `buildCompactionHandoff` writes the note that stands in for a summary none could be had of,
 *   from the Trace file being closed alone, so a restart rebuilds the note the live engine wrote.
 *
 * Everything here reads records and returns strings: no I/O, no engine state. The spelling of
 * every block lives in the markers module; what is quoted, and how much of it, is decided here.
 */
import { isCompleteModelMessage, isEventMessage } from "@prismshadow/amsp/records";
import type {
  AmspRecord,
  CompactionEndPayload,
  ErrorCode,
  RequestEndPayload,
  StopReason,
  TextPayload,
  ToolCallOutputPayload,
  ToolCallPayload,
} from "@prismshadow/amsp/records";
import {
  MARKER_TAGS,
  buildContextHandoffText,
  markerClose,
  markerOpen,
  salvageableSummary,
  transcribeRequestError,
  transcribeText,
  transcribeToolCall,
  transcribeToolCallOutput,
  transcribeUserInput,
} from "@prismshadow/amsp/markers";
import { approximateTokens } from "../llm/context-limits.js";

/** One request of a compaction span, as the engine saw it or as replay reads it back. */
export interface SpanRequest {
  /** How the request ended; absent when no `request_end` closes it. */
  status?: StopReason;
  errorCode?: ErrorCode;
  errorMessage?: string;
  /** The request's complete assistant text records, concatenated. */
  text: string;
}

/** One tool call of a committed compaction response, with the output that answered it. */
export interface SpanCall {
  call: AmspRecord<ToolCallPayload>;
  output?: AmspRecord<ToolCallOutputPayload>;
}

/** Compaction calls listed for the next context: the latest ones, each cut to these lengths. */
const MAX_COMPACTION_CALLS = 12;
const COMPACTION_ARGS_CHARS = 200;
const COMPACTION_OUTPUT_CHARS = 300;

/** The hand-off note's size, by the harness's own estimate. */
const HANDOFF_BUDGET_TOKENS = 4000;
/** User messages quoted after the first one. */
const HANDOFF_LAST_USER_MESSAGES = 8;
/** Tool calls of the last completed turn quoted in the note. */
const HANDOFF_TURN_MAX_CALLS = 8;
/** Steps by which every cap shrinks together once dropping user messages is not enough. */
const HANDOFF_SHRINK_STEPS = 16;
/** Characters of the provider's refusal the note quotes. */
const HANDOFF_REFUSAL_CHARS = 500;

/** How many characters of each quoted text a note keeps. */
interface QuoteCaps {
  /** The first user message: its head and its tail (an earlier summary's own transcript pointer is at its end). */
  firstHead: number;
  firstTail: number;
  /** Every other quoted user message: head and tail. */
  userHead: number;
  userTail: number;
  /** The last completed turn: each assistant text, each call's arguments, each output's text. */
  turnText: number;
  turnArgs: number;
  turnOutput: number;
  /** The compaction's own calls: arguments and output text. */
  callArgs: number;
  callOutput: number;
}

const FULL_CAPS: QuoteCaps = {
  firstHead: 3000,
  firstTail: 1000,
  userHead: 1200,
  userTail: 300,
  turnText: 1500,
  turnArgs: 400,
  turnOutput: 800,
  callArgs: COMPACTION_ARGS_CHARS,
  callOutput: COMPACTION_OUTPUT_CHARS,
};

function scaledCaps(factor: number): QuoteCaps {
  const caps = { ...FULL_CAPS };
  for (const key of Object.keys(caps) as (keyof QuoteCaps)[]) {
    caps[key] = Math.floor(FULL_CAPS[key] * factor);
  }
  return caps;
}

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
 * The records of the file's last compaction span: from its final `compaction_begin` through the
 * `compaction_end` that closes it (to the end of the file while none does; the whole file when it
 * holds no compaction). A span is one compaction's requests — its tool rounds, corrections, then
 * the request that wrote the summary — so the last completed request inside it is the summary's,
 * a request from before the span can never stand in for it, and the records written after its
 * end (Task records, the next Task's first input) are not part of it.
 */
export function closingSpan(file: AmspRecord[]): AmspRecord[] {
  const begin = lastCompactionBegin(file);
  if (begin === -1) return file;
  for (let i = begin + 1; i < file.length; i++) {
    if (isEvent(file[i]!, "compaction_end")) return file.slice(begin, i + 1);
  }
  return file.slice(begin);
}

/** The requests of a span, in order: how each ended and the assistant text it wrote. */
export function spanRequests(span: AmspRecord[]): SpanRequest[] {
  const requests: SpanRequest[] = [];
  let current: SpanRequest | null = null;
  for (const msg of span) {
    if (!isMainSession(msg)) continue;
    if (isEvent(msg, "request_begin")) {
      // A request with no end (only at a file's tail) still counts, its outcome unknown.
      if (current !== null) requests.push(current);
      current = { text: "" };
      continue;
    }
    if (isEvent(msg, "request_end")) {
      if (current === null) continue;
      const p = msg.payload as RequestEndPayload;
      current.status = p.status;
      if (p.error_code !== undefined) current.errorCode = p.error_code;
      if (p.error_message !== undefined) current.errorMessage = p.error_message;
      requests.push(current);
      current = null;
      continue;
    }
    if (current === null || !isCompleteModelMessage(msg)) continue;
    const p = msg.payload as Partial<TextPayload>;
    if (p.type === "text" && p.role === "assistant" && p.text) current.text += p.text;
  }
  if (current !== null) requests.push(current);
  return requests;
}

/**
 * The tool calls of a span's committed responses, in call order, each with the output that
 * answered it (anywhere in the span; absent when none was written). A call of a response that
 * was not committed is no call of the compaction: it was never answered or run.
 */
export function spanCalls(span: AmspRecord[]): SpanCall[] {
  const calls: AmspRecord<ToolCallPayload>[] = [];
  const outputs = new Map<string, AmspRecord<ToolCallOutputPayload>>();
  let pending: AmspRecord<ToolCallPayload>[] = [];
  for (const msg of span) {
    if (!isMainSession(msg)) continue;
    if (isEvent(msg, "request_begin")) {
      pending = [];
      continue;
    }
    if (isEvent(msg, "request_end")) {
      if ((msg.payload as RequestEndPayload).status === "completed") calls.push(...pending);
      pending = [];
      continue;
    }
    if (!isCompleteModelMessage(msg)) continue;
    const p = msg.payload as { type?: string; tool_call_id?: string };
    if (p.type === "tool_call") pending.push(msg as AmspRecord<ToolCallPayload>);
    else if (p.type === "tool_call_output" && p.tool_call_id && !outputs.has(p.tool_call_id)) {
      outputs.set(p.tool_call_id, msg as AmspRecord<ToolCallOutputPayload>);
    }
  }
  return calls.map((call) => {
    const output = outputs.get(call.payload.tool_call_id);
    return output !== undefined ? { call, output } : { call };
  });
}

/**
 * The summary to adopt when none was completed: over every request that did not complete, the
 * text inside its summary tag that reaches the salvage floor (`salvageableSummary`, closed or
 * not); the longest wins, the latest on a tie. Null when no request holds one. A completed
 * request is never a candidate — a completed reply holding a tagged summary was the summary.
 */
export function pickSalvage(requests: readonly SpanRequest[]): string | null {
  let best: string | null = null;
  for (const request of requests) {
    if (request.status === "completed") continue;
    const candidate = salvageableSummary(request.text);
    if (candidate !== "" && (best === null || candidate.length >= best.length)) best = candidate;
  }
  return best;
}

/**
 * The compaction's tool calls as the next context reads them: each `[tool_call]` line followed by
 * its `[tool_call_output]` line, in call order, the latest {@link MAX_COMPACTION_CALLS} at most
 * (a line says how many earlier ones are left out), arguments and outputs cut where long.
 */
export function compactionCallLines(calls: readonly SpanCall[]): string[] {
  return callLines(calls, COMPACTION_ARGS_CHARS, COMPACTION_OUTPUT_CHARS);
}

function callLines(calls: readonly SpanCall[], argsCap: number, outputCap: number): string[] {
  const listed = calls.slice(-MAX_COMPACTION_CALLS);
  const lines =
    calls.length > listed.length
      ? [omissionLine(`${count(calls.length - listed.length, "earlier tool call")} left out`)]
      : [];
  for (const call of listed) lines.push(...callPairLines(call, argsCap, outputCap));
  return lines;
}

/** A call's line and, when it was answered, its output's line (text only: images never cross). */
function callPairLines({ call, output }: SpanCall, argsCap: number, outputCap: number): string[] {
  const c = call.payload as Partial<ToolCallPayload>;
  const id = c.tool_call_id ?? "";
  const lines = [transcribeToolCall(c.name ?? "", id, headOf(c.arguments ?? "", argsCap))];
  if (output !== undefined) {
    const o = output.payload as Partial<ToolCallOutputPayload>;
    lines.push(
      transcribeToolCallOutput(id, o.status ?? "completed", headOf(o.output ?? "", outputCap)),
    );
  }
  return lines;
}

/** `[context_summary]` tag lines, both spellings: what a quoted user message loses. */
const SUMMARY_TAG_LINES: ReadonlySet<string> = new Set([
  markerOpen(MARKER_TAGS.contextSummary),
  markerClose(MARKER_TAGS.contextSummary),
  `<${MARKER_TAGS.contextSummary}>`,
  `</${MARKER_TAGS.contextSummary}>`,
]);

/**
 * The note that opens the next context when no summary could be had, built from the records of
 * the Trace file being closed alone — the same file gives the same note, live and on replay, and
 * records written after the span's end change nothing:
 *
 * - the user messages of the compacted context (every user text before the closing span and
 *   outside any earlier compaction span, whatever its sender), the first one and the last
 *   {@link HANDOFF_LAST_USER_MESSAGES}, an earlier summary's tag lines removed so it is quoted
 *   without nesting the block;
 * - the last completed turn before the span: its assistant texts and its tool calls, each with
 *   the output that answered it (text only; thinking is not quoted);
 * - when the span's own `compaction_end` says the provider refused the request after that turn
 *   (`rejected`: an ordinary request answered by this hand-off, or the compaction's own), its
 *   error as the provider wrote it, the first {@link HANDOFF_REFUSAL_CHARS} characters; the
 *   cause of any other end is left out;
 * - the compaction's own calls ({@link compactionCallLines}).
 *
 * Every quoted text is cut to its cap, and the note is kept within its token budget by dropping
 * the oldest of the last messages one by one; when that is not enough (long non-ASCII text, a
 * turn with many outputs), every cap shrinks by one factor, the largest that fits. Without a
 * Trace path nothing can be pointed at or copied from, and the note is its explanation alone.
 */
export function buildCompactionHandoff(
  file: AmspRecord[],
  opts: { tracePath?: string; shell?: string },
): string {
  const { tracePath, shell } = opts;
  if (tracePath === undefined) {
    return buildContextHandoffText({
      userLines: [],
      turnLines: [],
      refusalLines: [],
      callLines: [],
    });
  }
  const transcript = { tracePath, ...(shell !== undefined ? { shell } : {}) };
  const main = file.filter(isMainSession);
  const begin = lastCompactionBegin(main);
  const before = begin === -1 ? main : main.slice(0, begin);
  const span = begin === -1 ? [] : closingSpan(main);
  const context = outsideCompactionSpans(before);

  const users = context.flatMap((msg) => {
    const text = userTextOf(msg);
    if (text === null) return [];
    const quoted = withoutSummaryTagLines(text);
    return quoted.trim() === "" ? [] : [quoted];
  });
  const first = users[0];
  const last = users.slice(1).slice(-HANDOFF_LAST_USER_MESSAGES);
  const leftOut = Math.max(0, users.length - 1 - last.length);
  const turn = lastCompletedTurn(context);
  const outputs = outputsById([...before, ...span]);
  const calls = spanCalls(span);
  const refusal = refusalLines(span);

  const build = (dropped: number, caps: QuoteCaps): string =>
    buildContextHandoffText(
      {
        userLines: userLines(first, last.slice(dropped), leftOut + dropped, caps),
        turnLines: turn !== null ? turnLines(turn, outputs, caps) : [],
        refusalLines: refusal,
        callLines: callLines(calls, caps.callArgs, caps.callOutput),
      },
      transcript,
    );

  let dropped = 0;
  let note = build(dropped, FULL_CAPS);
  while (approximateTokens(note) > HANDOFF_BUDGET_TOKENS && dropped < last.length) {
    dropped += 1;
    note = build(dropped, FULL_CAPS);
  }
  for (
    let step = HANDOFF_SHRINK_STEPS - 1;
    step >= 0 && approximateTokens(note) > HANDOFF_BUDGET_TOKENS;
    step--
  ) {
    note = build(dropped, scaledCaps(step / HANDOFF_SHRINK_STEPS));
  }
  return note;
}

/**
 * The refusal section of a note: the `[request_error]` line of the span's own `compaction_end`
 * when it says `rejected`, the provider's text cut to its cap; empty for any other end, and
 * while the span has none.
 */
function refusalLines(span: readonly AmspRecord[]): string[] {
  const end = span.at(-1);
  if (end === undefined || !isEvent(end, "compaction_end")) return [];
  const p = end.payload as Partial<CompactionEndPayload>;
  if (p.error_code !== "rejected") return [];
  const message = headOf(p.error_message ?? "", HANDOFF_REFUSAL_CHARS);
  return [transcribeRequestError(p.error_code, message)];
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

/** The text of a complete user text record, or null for any other record. */
function userTextOf(msg: AmspRecord): string | null {
  if (!isCompleteModelMessage(msg)) return null;
  const p = msg.payload as Partial<TextPayload>;
  return p.type === "text" && p.role === "user" && typeof p.text === "string" ? p.text : null;
}

function withoutSummaryTagLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => !SUMMARY_TAG_LINES.has(line.trim()))
    .join("\n");
}

/** The records of the last completed request (between its begin and its end), or null when none completed. */
function lastCompletedTurn(context: readonly AmspRecord[]): AmspRecord[] | null {
  for (let end = context.length - 1; end >= 0; end--) {
    const msg = context[end]!;
    if (!isEvent(msg, "request_end")) continue;
    if ((msg.payload as RequestEndPayload).status !== "completed") continue;
    let begin = end - 1;
    while (begin >= 0 && !isEvent(context[begin]!, "request_begin")) begin--;
    return context.slice(begin + 1, end);
  }
  return null;
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

function userLines(
  first: string | undefined,
  last: readonly string[],
  leftOut: number,
  caps: QuoteCaps,
): string[] {
  if (first === undefined) return [];
  const lines = [transcribeUserInput(headAndTailOf(first, caps.firstHead, caps.firstTail))];
  if (leftOut > 0) lines.push(omissionLine(`${count(leftOut, "message")} left out`));
  for (const text of last) {
    lines.push(transcribeUserInput(headAndTailOf(text, caps.userHead, caps.userTail)));
  }
  return lines;
}

function turnLines(
  turn: readonly AmspRecord[],
  outputs: ReadonlyMap<string, AmspRecord<ToolCallOutputPayload>>,
  caps: QuoteCaps,
): string[] {
  const lines: string[] = [];
  let quotedCalls = 0;
  let leftOutCalls = 0;
  for (const msg of turn) {
    if (!isCompleteModelMessage(msg)) continue;
    const p = msg.payload as { type?: string; role?: string; text?: string; tool_call_id?: string };
    if (p.type === "text") {
      const text = p.text ?? "";
      if (p.role === "assistant" && text.trim() !== "") {
        lines.push(transcribeText(headOf(text, caps.turnText)));
      }
    } else if (p.type === "tool_call") {
      if (quotedCalls >= HANDOFF_TURN_MAX_CALLS) {
        leftOutCalls += 1;
        continue;
      }
      quotedCalls += 1;
      const call = msg as AmspRecord<ToolCallPayload>;
      const output = outputs.get(p.tool_call_id ?? "");
      const pair: SpanCall = output !== undefined ? { call, output } : { call };
      lines.push(...callPairLines(pair, caps.turnArgs, caps.turnOutput));
    }
  }
  if (leftOutCalls > 0) {
    lines.push(omissionLine(`${count(leftOutCalls, "more tool call")} left out`));
  }
  return lines;
}

/** A line of its own saying what a section leaves out. */
function omissionLine(what: string): string {
  return `  …[${what}]…`;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** `text` cut to its first `cap` characters, marked with how many were left out. */
function headOf(text: string, cap: number): string {
  if (text.length <= cap) return text;
  const head = text.slice(0, boundaryBefore(text, cap));
  return joinCut(head, `…[${count(text.length - head.length, "character")} left out]`, "");
}

/** `text` cut to its first `headCap` and its last `tailCap` characters, the cut marked between them. */
function headAndTailOf(text: string, headCap: number, tailCap: number): string {
  if (text.length <= headCap + tailCap) return text;
  const head = text.slice(0, boundaryBefore(text, headCap));
  const tail = text.slice(boundaryAfter(text, text.length - tailCap));
  const cut = text.length - head.length - tail.length;
  return joinCut(head, `…[${count(cut, "character")} left out]…`, tail);
}

function joinCut(head: string, marker: string, tail: string): string {
  return [head, marker, tail].filter((part) => part !== "").join(" ");
}

/** `index`, moved back one when it would split a surrogate pair. */
function boundaryBefore(text: string, index: number): number {
  const code = text.charCodeAt(index - 1);
  return index > 0 && code >= 0xd800 && code <= 0xdbff ? index - 1 : index;
}

/** `index`, moved on one when it would start inside a surrogate pair. */
function boundaryAfter(text: string, index: number): number {
  const code = text.charCodeAt(index);
  return index < text.length && code >= 0xdc00 && code <= 0xdfff ? index + 1 : index;
}
