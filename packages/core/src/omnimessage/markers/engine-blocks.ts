/**
 * Engine-synthesized marker blocks: the interruption/retry transcripts and the compaction
 * summary. These are produced by the ReAct loop (and rebuilt by Trace replay), never by a
 * host — but their spelling belongs here with the rest of the markers so the engine and the
 * resume path cannot drift apart (they used to duplicate the `[context_summary]` template).
 */
import { dualFormPatterns, markerBlock, matchDualForm } from "./block.js";
import { MARKER_TAGS, TRANSCRIPT_TAGS } from "./tags.js";

/** Wraps a compaction summary as the new context's first input: `[context_summary]…[/context_summary]`. */
export function buildContextSummaryText(summary: string): string {
  return markerBlock(MARKER_TAGS.contextSummary, summary);
}

const SUMMARY_PATTERNS = dualFormPatterns(MARKER_TAGS.summary, "([\\s\\S]*?)");

/**
 * Extracts the summary the model wrote inside `[summary]…[/summary]` during compaction; when
 * the tag is missing, leniently uses the entire output as-is (not treated as a failure).
 *
 * The legacy `<summary></summary>` form must stay accepted **indefinitely**:
 * `compaction.prompt` is persisted in every existing agent's `system_config.yaml`, so old
 * agents keep instructing the model to use the angle-bracket tags.
 */
export function extractSummary(raw: string): string {
  const match = matchDualForm(SUMMARY_PATTERNS, raw);
  return (match ? match[1]! : raw).trim();
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
