/**
 * Local date helpers (same convention as core's Trace date directories: local timezone
 * yyyy-mm-dd). Shared by the usage_records.date aggregation key and stats windows
 * (today / last 7 days / last 30 days).
 */

/** Format a time as a local `yyyy-mm-dd` (4-digit year, zero-padded 2-digit month/day). */
export function formatLocalDate(date: Date): string {
  const year = date.getFullYear().toString().padStart(4, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Subtract N days from a local date (used for the start of the last-7-days / last-30-days windows). */
export function localDateMinusDays(date: Date, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() - days);
  return formatLocalDate(d);
}
