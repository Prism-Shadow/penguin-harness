/**
 * Durations as the app and the CLI print them: `820ms`, `2.3s`, `1m3s`. Two forms, because a
 * settled duration and a running clock read differently: the settled one keeps a tenth of a
 * second below a minute, the running one shows whole seconds only — a live timer showing tenths
 * reads as jitter.
 */

/** One decimal place, a trailing `.0` dropped. */
function trimZero(v: number): string {
  const s = v.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

/**
 * A settled duration: `820ms`, `2.3s`, `1m3s`. `compact` (a narrow row) drops the tenth from 10s
 * up (`12s`, not `12.7s`); below 10s the tenth is significant and stays.
 */
export function formatDuration(ms: number, opts?: { compact?: boolean }): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60 && !(opts?.compact && s >= 10)) return `${trimZero(s)}s`;
  // Round the total before splitting it: rounding the remainder while flooring the minutes
  // would print 119.7s as `1m60s` instead of `2m0s`.
  const whole = Math.round(s);
  if (whole < 60) return `${whole}s`;
  return `${Math.floor(whole / 60)}m${whole % 60}s`;
}

/**
 * A running clock: whole seconds only (`0s`, `7s`, `1m3s`), counting up and never showing a
 * second early. A negative span (a start stamp from a clock ahead of this one) reads as `0s`.
 */
export function formatDurationLive(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${s % 60}s`;
}
