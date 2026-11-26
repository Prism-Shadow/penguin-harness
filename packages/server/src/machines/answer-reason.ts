/**
 * Why a machine's server did not answer a question: the reason its answer gives, carried into the
 * sentence a job says.
 *
 * A status alone tells a person nothing they can act on. "It answered 503 when asked its version"
 * is the same sentence for a server that is still starting and for one whose platform could not
 * boot, and the body says which — `penguin-server has no running platform: <why>` (hmr/starting.ts),
 * or the API's error envelope for a refusal. So the body's own words follow the status: the
 * envelope's message, else its first line, on one line and cut to a length a job's log can hold.
 */

/** The longest reason carried; a longer one is cut and ends in an ellipsis. */
const LONGEST_REASON = 200;

/**
 * The reason an answer's body gives: the API error envelope's `error.message`, else its first
 * non-empty line. Null when it gives none — an empty body, or a page of markup, whose first line
 * (`<!doctype html>`) is no reason.
 */
export function answerReason(text: string): string | null {
  let said: string | undefined;
  try {
    const body = JSON.parse(text) as { error?: { message?: unknown } } | null;
    const message = body?.error?.message;
    if (typeof message === "string") said = message;
  } catch {
    // Not the API's error envelope; its text is the reason.
  }
  said ??= text.split(/\r?\n/).find((line) => line.trim() !== "");
  if (said === undefined) return null;
  const line = said.replace(/\s+/g, " ").trim();
  if (line === "" || line.startsWith("<")) return null;
  return line.length <= LONGEST_REASON ? line : `${line.slice(0, LONGEST_REASON - 1)}…`;
}

/** `it answered <status> when asked <what>`, and the reason the answer gives when it gives one. */
export function answeredWhenAsked(answer: { status: number; text: string }, what: string): string {
  const reason = answerReason(answer.text);
  return `it answered ${answer.status} when asked ${what}${reason === null ? "" : `: ${reason}`}`;
}
