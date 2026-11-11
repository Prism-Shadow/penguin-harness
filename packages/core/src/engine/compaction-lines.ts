/**
 * The harness's own lines inside a summarize compaction: the line behind each tool round's
 * outputs, the refusal a call gets once no round is open, and the corrective lines that answer
 * a response which advanced nothing. They are protocol text, hardcoded like the `[tool error]`
 * strings; the Prompt stays editable config, so every line points at "the format the compaction
 * request gave" instead of restating it, and holds for a stored or customised Prompt too.
 * Each is user-side text appended to the old context — Trace-only, never streamed.
 */

const REPLY_NOW =
  "Reply now with the summary, text only, in the format the compaction request gave.";

/**
 * The line behind a round's tool outputs: how many rounds are used and whether another is open.
 * `open` false with rounds left means the window, not the count, closed the next one.
 */
export function roundLine(used: number, max: number, open: boolean): string {
  if (open) {
    return `Tool round ${used} of ${max} used; ${max - used} left. Reply with the summary as soon as the hand-off files are written.`;
  }
  const closed =
    used >= max
      ? `Tool round ${used} of ${max} used; none left. Any further tool call will be refused.`
      : `Tool round ${used} of ${max} used. The context window has no room for another, so any further tool call will be refused.`;
  return `${closed} ${REPLY_NOW}`;
}

/** Why a call is refused once no round is open (inside its `[tool error]` output). */
export const REFUSED_NO_ROUND = "no tool round is left in this compaction; reply with the summary";

/** After a response whose calls were all refused because no round was open. */
export const CLOSED_LINE = `Those tool calls were refused: no tool round is left. ${REPLY_NOW}`;

/** After a committed response that held no summary. */
export const EMPTY_LINE = `Your previous reply held no summary. ${REPLY_NOW}`;

/** After a response cut at the output limit (never committed: it rides the same input once). */
export const TRUNCATED_LINE =
  "Your previous reply hit the output limit and was discarded. Reply again with a shorter summary, text only, in the format the compaction request gave, and keep the next steps complete.";
