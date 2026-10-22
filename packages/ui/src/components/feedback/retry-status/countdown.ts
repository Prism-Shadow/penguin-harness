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
