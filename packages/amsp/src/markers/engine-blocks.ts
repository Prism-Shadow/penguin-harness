/**
 * Engine-synthesized marker blocks: the interruption/retry transcripts and the compaction
 * summary. These are produced by the ReAct loop (and rebuilt by Trace replay), never by a
 * host — but their spelling belongs here with the rest of the markers so the engine and the
 * resume path cannot drift apart (they used to duplicate the `[context_summary]` template).
 */
import { markerBlock, markerClose, markerOpen, matchDualForm } from "./block.js";
import { MARKER_TAGS, TRANSCRIPT_TAGS } from "./tags.js";
import { traceQueryGuidance } from "./trace-query.js";

/** Where the compacted context's transcript is, for the `[context_summary]` trailer. */
export interface CompactedTranscript {
  /** Absolute path of the Trace file of the context the summary replaces. */
  tracePath: string;
  /** The shell the Session's commands run in (the system prompt's `Shell:` value), when known: the trailer's search is worded for it. */
  shell?: string;
}

/** What the harness adds under a summary besides the transcript trailer; each line appears only when it applies. */
export interface ContextSummaryExtras {
  /** The summary was salvaged from a reply that did not finish: a line says it was cut off. */
  cutOff?: boolean;
  /** The compaction's tool calls with their outputs, transcribed (empty or absent: no section). */
  callLines?: readonly string[];
  /** A note from the harness about how this context was opened (empty or absent: no notice line). */
  notice?: string;
}

/** The sentence both blocks use after a Trace path: where the conversation's earlier files are. */
const EARLIER_FILES =
  "Earlier files of this conversation share the name with a lower number, in the same or an earlier date folder.";

/** Heads the transcribed tool calls of a compaction, under a summary and in a hand-off note alike. */
const COMPACTION_CALLS_HEADER =
  'Tool calls made during this compaction, as the harness recorded them; a hand-off file exists only if its call shows status="completed":';

const CUT_OFF_LINE =
  "The summary above was cut off before its end: the reply that wrote it did not finish, so its last sections may be missing.";
const CUT_OFF_READ_TRANSCRIPT =
  " Read the last records of the transcript below before you continue.";

/** The transcript pointer and the query guidance that close a block naming a Trace file. */
function transcriptLines(lead: string, transcript: CompactedTranscript): string[] {
  return [
    `${lead}: ${transcript.tracePath}. ${EARLIER_FILES}`,
    traceQueryGuidance(transcript.shell),
  ];
}

/**
 * Wraps a compaction summary as the new context's first input: `[context_summary]…[/context_summary]`.
 *
 * Under the summary, after a blank line, come the extras that apply and, given the compacted
 * context's Trace file, the trailer naming it. All of it is plain text inside the block, so a
 * reader that knows the block by its prefix reads an old summary the same way; with neither,
 * the block is exactly what it was before they existed.
 */
export function buildContextSummaryText(
  summary: string,
  transcript?: CompactedTranscript,
  extras?: ContextSummaryExtras,
): string {
  const lines: string[] = [];
  if (extras?.cutOff === true) {
    // Without a transcript there is nothing below to read the missing tail from.
    lines.push(transcript !== undefined ? CUT_OFF_LINE + CUT_OFF_READ_TRANSCRIPT : CUT_OFF_LINE);
  }
  if (extras?.callLines !== undefined && extras.callLines.length > 0) {
    lines.push(COMPACTION_CALLS_HEADER, ...extras.callLines);
  }
  if (extras?.notice !== undefined && extras.notice !== "") {
    lines.push(`Harness notice: ${extras.notice}`);
  }
  if (transcript !== undefined) {
    lines.push(
      ...transcriptLines(
        "Transcript of the compacted context, for when the summary is not enough",
        transcript,
      ),
    );
  }
  if (lines.length === 0) return markerBlock(MARKER_TAGS.contextSummary, summary);
  return markerBlock(MARKER_TAGS.contextSummary, `${summary}\n\n${lines.join("\n")}`);
}

/** The sections of a hand-off note, each already transcribed into two-space indented lines. */
export interface ContextHandoffSections {
  /** The compacted context's user messages, oldest first (`[user_input]` lines, and the line saying how many were left out). */
  userLines: readonly string[];
  /** The last completed turn before the compaction: its `[text]`, `[tool_call]` and `[tool_call_output]` lines. */
  turnLines: readonly string[];
  /** The provider's refusal of the request after that turn: a `[request_error]` line, or none. */
  refusalLines: readonly string[];
  /** The compaction's own tool calls with their outputs, as under a summary (see ContextSummaryExtras.callLines). */
  callLines: readonly string[];
}

const HANDOFF_LEAD_OPENING =
  "No summary of the earlier conversation could be written, so the harness wrote this note in its place. The conversation up to this point is no longer in your context; ";
const HANDOFF_LEAD_TRANSCRIPT =
  "its transcript is the file named below, and what follows is copied from it, shortened where marked. Carry on with the task from where it stopped; when you need more than this note holds, query the transcript first.";
const HANDOFF_LEAD_NO_TRANSCRIPT =
  "no transcript of it is recorded. Carry on with the task from where it stopped.";
const HANDOFF_LEAD_CLOSING =
  " Consent does not carry over: anything that needed a go-ahead is asked again.";
/** Heads the refusal section: without it a model would rebuild the very input that was refused. */
const HANDOFF_REFUSAL_HEADING =
  "The request after that turn was refused by the provider, which is why this context was closed; its error is below. If the refusal was about size, do not rebuild the same input: read large files and outputs in parts.";

/**
 * The hand-off note a compaction opens the next context with when no summary could be had,
 * wrapped like a summary so every reader that knows the block by its prefix carries it as one:
 * the harness's explanation, each non-empty section under its heading, then, given the compacted
 * context's Trace file, its path and how to query it. What to quote is the caller's choice
 * (core's compaction-carry).
 */
export function buildContextHandoffText(
  sections: ContextHandoffSections,
  transcript?: CompactedTranscript,
): string {
  const parts = [
    HANDOFF_LEAD_OPENING +
      (transcript !== undefined ? HANDOFF_LEAD_TRANSCRIPT : HANDOFF_LEAD_NO_TRANSCRIPT) +
      HANDOFF_LEAD_CLOSING,
  ];
  const section = (heading: string, lines: readonly string[]): void => {
    if (lines.length > 0) parts.push([heading, ...lines].join("\n"));
  };
  section("User messages of the compacted context, oldest first:", sections.userLines);
  section("The last completed turn before the compaction:", sections.turnLines);
  section(HANDOFF_REFUSAL_HEADING, sections.refusalLines);
  section(COMPACTION_CALLS_HEADER, sections.callLines);
  if (transcript !== undefined) {
    parts.push(transcriptLines("Transcript of the compacted context", transcript).join("\n"));
  }
  return markerBlock(MARKER_TAGS.contextSummary, parts.join("\n\n"));
}

/** Least characters a summary cut off before its close tag must hold inside the tag to be adopted. */
export const SALVAGE_MIN_CHARS = 400;

/** The summary tag's two spellings, current form first (see block.ts for the dual-form policy). */
const SUMMARY_TAG_FORMS: readonly (readonly [open: string, close: string])[] = [
  [markerOpen(MARKER_TAGS.summary), markerClose(MARKER_TAGS.summary)],
  [`<${MARKER_TAGS.summary}>`, `</${MARKER_TAGS.summary}>`],
];

/**
 * Summary close tags spelled with mixed brackets, `[/summary>` and `</summary]`: a reply that
 * closed the tag half in the other form (deepseek-flash observed, about one summary in ten).
 * Either one closes a summary opened in either form and is stripped where stray, so it never
 * rides into the next context; a reply without one reads exactly as it did before.
 */
const MIXED_SUMMARY_CLOSES: readonly string[] = [
  `[/${MARKER_TAGS.summary}>`,
  `</${MARKER_TAGS.summary}]`,
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A regex alternative matching every close of a summary opened in `close`'s form. */
function summaryCloseSource(close: string): string {
  return `(?:${[close, ...MIXED_SUMMARY_CLOSES].map(escapeRegExp).join("|")})`;
}

/**
 * Removes, in order, each form's blocks (closed by their own close or a mixed one) and its stray
 * tags, then stray mixed closes — for well-formed tags, exactly what stripMarkerBlocks removes.
 */
const SUMMARY_STRIPS: readonly RegExp[] = [
  ...SUMMARY_TAG_FORMS.flatMap(([open, close]) => [
    new RegExp(`${escapeRegExp(open)}[\\s\\S]*?${summaryCloseSource(close)}`, "g"),
    new RegExp(`${escapeRegExp(open)}|${escapeRegExp(close)}`, "g"),
  ]),
  new RegExp(MIXED_SUMMARY_CLOSES.map(escapeRegExp).join("|"), "g"),
];

/** `text` without summary blocks and stray summary tags, mixed-bracket closes included. */
function stripSummaryTags(text: string): string {
  return SUMMARY_STRIPS.reduce((out, pattern) => out.replace(pattern, ""), text);
}

/** Where the first close of a summary opened in `close`'s form starts at or after `from`, or -1. */
function summaryCloseAt(raw: string, from: number, close: string): number {
  let at = -1;
  for (const spelling of [close, ...MIXED_SUMMARY_CLOSES]) {
    const i = raw.indexOf(spelling, from);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  return at;
}

/**
 * The text after a reply's first `[summary]` open tag (the legacy `<summary>` one when it has no
 * square tag) up to its close, a mixed-bracket one included, else to the reply's end — stray
 * summary tags stripped, trimmed; `closed` says whether a close was found; null without an open
 * tag. Unlike {@link extractSummary} it reads only inside the tag, so it tells a summary from a
 * preamble before tool calls, and keeps a summary cut off before it closed.
 */
export function summaryInTags(raw: string): { text: string; closed: boolean } | null {
  for (const [open, close] of SUMMARY_TAG_FORMS) {
    const start = raw.indexOf(open);
    if (start === -1) continue;
    const from = start + open.length;
    const end = summaryCloseAt(raw, from, close);
    const inside = end === -1 ? raw.slice(from) : raw.slice(from, end);
    return { text: stripSummaryTags(inside).trim(), closed: end !== -1 };
  }
  return null;
}

/**
 * The summary a reply that did not finish still holds: {@link summaryInTags}'s text, closed or
 * not, once it reaches {@link SALVAGE_MIN_CHARS}; otherwise the empty string.
 */
export function salvageableSummary(raw: string): string {
  const inTags = summaryInTags(raw);
  return inTags !== null && inTags.text.length >= SALVAGE_MIN_CHARS ? inTags.text : "";
}

/** Each form's summary block, its body captured; a mixed-bracket close ends it too. */
const SUMMARY_PATTERNS: readonly RegExp[] = SUMMARY_TAG_FORMS.map(
  ([open, close]) =>
    new RegExp(`${escapeRegExp(open)}([\\s\\S]*?)${summaryCloseSource(close)}`, "g"),
);

/**
 * Extracts the summary the model wrote during compaction, with a tolerance ladder (issue #170:
 * some models — deepseek-v4-flash observed — treat the tags as a "title" and write the body
 * outside them):
 *   1. the first `[summary]…[/summary]` pair whose content is non-empty once stray summary
 *      tags are stripped (so a nested `[summary]` line doesn't hide the text after it);
 *   2. otherwise, everything left after stripping the (empty) summary blocks and stray tags —
 *      rescues output shaped `[summary]\n[/summary]\n<the actual summary>`;
 *   3. tagless output stays used verbatim. An empty return means the output was genuinely
 *      empty — the caller treats that as a failed attempt.
 * Step 1 preserves the historical result for every healthy output, so resume re-extracting
 * from an old Trace reconstructs the same summary the live session used.
 *
 * The legacy `<summary></summary>` form must stay accepted **indefinitely**:
 * `compaction.prompt` is persisted in every existing agent's `system_config.yaml`, so old
 * agents keep instructing the model to use the angle-bracket tags.
 */
export function extractSummary(raw: string): string {
  for (const pattern of SUMMARY_PATTERNS) {
    for (const match of raw.matchAll(pattern)) {
      const inside = stripSummaryTags(match[1]!).trim();
      if (inside !== "") return inside;
    }
  }
  return stripSummaryTags(raw).trim();
}

/** One transcribed line inside a turn block: an inner tag, optional attributes, and the body. */
function transcriptLine(tag: string, body: string, attrs = ""): string {
  return `  [${tag}${attrs}]${body}[/${tag}]`;
}

/** `[user_input]…[/user_input]` — a text input of the interrupted turn. */
export function transcribeUserInput(text: string): string {
  return transcriptLine(TRANSCRIPT_TAGS.userInput, text);
}

/** `[thinking]…[/thinking]` — a thinking segment the model produced before the interruption. */
export function transcribeThinking(thinking: string): string {
  return transcriptLine(TRANSCRIPT_TAGS.thinking, thinking);
}

/** `[text]…[/text]` — a text segment the model produced before the interruption. */
export function transcribeText(text: string): string {
  return transcriptLine(TRANSCRIPT_TAGS.text, text);
}

/** `[tool_call name=… id=…]arguments[/tool_call]` — a tool call already issued. */
export function transcribeToolCall(name: string, toolCallId: string, args: string): string {
  return transcriptLine(TRANSCRIPT_TAGS.toolCall, args, ` name="${name}" id="${toolCallId}"`);
}

/** `[tool_call_output id=… status=…]output[/tool_call_output]` — a tool result already produced. */
export function transcribeToolCallOutput(
  toolCallId: string,
  status: string,
  output: string,
): string {
  return transcriptLine(
    TRANSCRIPT_TAGS.toolCallOutput,
    output,
    ` id="${toolCallId}" status="${status}"`,
  );
}

/**
 * `[request_error code=…]message[/request_error]` — how the last failed attempt's request
 * ended: the unified error code, and the provider's or transport's text exactly as it came
 * (empty when the failure carried none, such as an idle timeout). Written so the model can
 * judge for itself what went wrong before it carries on; the harness adds no reading of its
 * own. A block holds at most one such line, the latest failure's: see stripRequestErrorLines.
 */
export function transcribeRequestError(
  code: string | undefined,
  message: string | undefined,
): string {
  return transcriptLine(TRANSCRIPT_TAGS.requestError, message ?? "", code ? ` code="${code}"` : "");
}

const REQUEST_ERROR_LINE = new RegExp(
  `^ {2}\\[${TRANSCRIPT_TAGS.requestError}(?: [^\\]]*)?\\][\\s\\S]*?\\[/${TRANSCRIPT_TAGS.requestError}\\]\\n?`,
  "gm",
);

/**
 * The inner lines of a synthetic block without their request_error line. A block carries at
 * most one, the latest failure's, so a block rebuilt from an older one (a `[turn_retried]`
 * merged into a `[turn_aborted]`, or a previous run's carry-over) drops the old line before
 * the new outcome's goes in — or stays without one when the new outcome is a user interruption.
 */
export function stripRequestErrorLines(inner: string): string {
  return inner.replace(REQUEST_ERROR_LINE, "").replace(/\n$/, "");
}

/** Wraps transcribed lines as the interruption block resent as carry-over. */
export function buildTurnAbortedBlock(lines: readonly string[]): string {
  return [`[${MARKER_TAGS.turnAborted}]`, ...lines, `[/${MARKER_TAGS.turnAborted}]`].join("\n");
}

/** Wraps transcribed lines as the reconnect-retry block appended to the resent input. */
export function buildTurnRetriedBlock(lines: readonly string[]): string {
  return [`[${MARKER_TAGS.turnRetried}]`, ...lines, `[/${MARKER_TAGS.turnRetried}]`].join("\n");
}

/**
 * Both synthetic turn blocks share one matcher (a backreference keeps the tags paired): the
 * current square form first, then the legacy angle form — resume replays a discarded turn's
 * original input as-is, so text written to a Trace before the marker format changed can still
 * flow back in.
 */
const SYNTHETIC_BLOCK_PATTERNS: readonly [RegExp, RegExp] = [
  new RegExp(
    `^\\[(${MARKER_TAGS.turnAborted}|${MARKER_TAGS.turnRetried})\\]\\n?([\\s\\S]*?)\\n?\\[/\\1\\]\\s*$`,
  ),
  new RegExp(
    `^<(${MARKER_TAGS.turnAborted}|${MARKER_TAGS.turnRetried})>\\n?([\\s\\S]*?)\\n?</\\1>\\s*$`,
  ),
];

/**
 * If the text is an engine-synthesized whole block (`[turn_aborted]` or `[turn_retried]`),
 * strips the outer tags and returns the inner lines (possibly an empty string); otherwise
 * null. Both kinds use identical inner markup, so the content can be merged straight into a
 * new block, keeping a single-level structure.
 */
export function unwrapSyntheticBlock(text: string): string | null {
  const m = matchDualForm(SYNTHETIC_BLOCK_PATTERNS, text);
  return m ? m[2]! : null;
}
