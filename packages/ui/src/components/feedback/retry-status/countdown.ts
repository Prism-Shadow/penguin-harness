/**
 * The seconds a countdown shows: whole seconds left until `targetMs`, rounded up so the line
 * reaches 0 only when the moment has come, and never below 0. Null without a target — nothing to
 * count down to.
 */
export function countdownSeconds(
  targetMs: number | null | undefined,
  nowMs: number,
): number | null {
  if (targetMs === null || targetMs === undefined) return null;
  return Math.max(0, Math.ceil((targetMs - nowMs) / 1000));
}

/** A number no countdown sentence holds by itself: where it lands is where the seconds go. */
const PROBE = 987_654_321;

/**
 * The caller's countdown sentence around its seconds: the words before them and after them, so the
 * row can set the seconds in a slot that keeps the width of the wait's widest number and the line
 * does not shift as they count down (10 to 9 s). Found by asking the sentence for a number it
 * cannot otherwise contain, so it holds in every language, wherever the seconds sit. Null when the
 * sentence does not show the seconds it is given.
 */
export function countdownParts(
  countdown: (seconds: number) => string,
): { before: string; after: string } | null {
  const probe = String(PROBE);
  const sentence = countdown(PROBE);
  const at = sentence.indexOf(probe);
  if (at < 0) return null;
  return { before: sentence.slice(0, at), after: sentence.slice(at + probe.length) };
}
