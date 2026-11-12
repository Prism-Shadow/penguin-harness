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
 * The rounds a compaction aims at. Under it a round line shows no total — the cap would read as
 * the plan, and a smaller number would be false; from it on, the line asks for the summary.
 */
export const COMPACTION_TARGET_ROUNDS = 3;

/**
 * The line behind a round's tool outputs: how many rounds are used and, once the target is
 * reached, that the summary is due and how many more rounds the harness runs. `open` false
 * with rounds left means the window, not the count, closed the next one.
 */
export function roundLine(used: number, max: number, open: boolean): string {
  if (open && used < Math.min(COMPACTION_TARGET_ROUNDS, max)) {
    return `Tool round ${used} done. Reply with the summary as soon as the hand-off files are written.`;
  }
  if (open) {
    const left = max - used;
    return `Tool round ${used} done; a compaction should not need more. Reply with the summary now, and write any hand-off file still missing in that same reply. The harness runs tool calls for ${left} more ${left === 1 ? "round" : "rounds"}, then refuses them.`;
  }
  const closed =
    used >= max
      ? `Tool round ${used} done; the harness runs no more. Any further tool call will be refused.`
      : `Tool round ${used} done. The context window has no room for another, so any further tool call will be refused.`;
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
