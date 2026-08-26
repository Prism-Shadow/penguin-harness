/**
 * `--timeout` duration parsing for the waiting commands (`run`, `input`, `logs -f`).
 * Accepted shapes: `30s`, `5m`, `2h`, or a bare positive integer meaning seconds.
 * Anything else is rejected by returning null (the caller prints the localized error).
 */
export function parseDurationMs(raw: string): number | null {
  const m = /^(\d+)([smh])?$/.exec(raw.trim());
  if (m === null) return null;
  const n = Number(m[1]);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  const unit = m[2] ?? "s";
  return n * (unit === "s" ? 1000 : unit === "m" ? 60_000 : 3_600_000);
}
