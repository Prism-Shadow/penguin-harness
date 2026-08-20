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

// —— Time-series bucket keys (usage series aggregation) ——
//
// Bucket keys must agree byte-for-byte between the SQL aggregation (see UsageRepo's
// bucketExpr) and the zero-fill enumeration here, or filled gaps and aggregated rows
// land in different buckets:
//   hour  → `yyyy-mm-ddThh:00` (local clock, from the row's ts)
//   day   → `yyyy-mm-dd`       (the row's date column)
//   week  → `yyyy-mm-dd` of the ISO week's Monday
//   month → `yyyy-mm`

/** Time-series precision for the usage series (mirrors the API's UsageGranularity). */
export type BucketGranularity = "hour" | "day" | "week" | "month";

/** Parse a local `yyyy-mm-dd` into a local-midnight Date. */
function parseLocalDate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

/** Format a local hour bucket key: `yyyy-mm-ddThh:00`. */
export function formatLocalHourKey(date: Date): string {
  const hour = date.getHours().toString().padStart(2, "0");
  return `${formatLocalDate(date)}T${hour}:00`;
}

/** Monday of the ISO week containing the given local date (`yyyy-mm-dd` in, `yyyy-mm-dd` out). */
export function localWeekStart(date: string): string {
  const d = parseLocalDate(date);
  // getDay: 0=Sunday … 6=Saturday; back up (day+6)%7 days to reach Monday.
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return formatLocalDate(d);
}

/** Month bucket key: `yyyy-mm`. */
export function localMonthKey(date: string): string {
  return date.slice(0, 7);
}

/**
 * All bucket keys covering the inclusive local-date range, in ascending order —
 * the zero-fill skeleton for the usage series (an empty bucket must still appear
 * as a point, or a line chart would silently connect across the gap).
 * `from > to` yields an empty list. Hour keys are enumerated by stepping real
 * timestamps (not a fixed 24 per day), so a DST-shifted day keeps the same keys
 * SQLite's `localtime` produces; duplicate fall-back hours collapse to one key.
 * Enumeration stops one key past `cap`, so a caller rejecting oversized ranges
 * (`keys.length > cap`) never materializes an unbounded array first.
 */
export function enumerateBuckets(
  from: string,
  to: string,
  granularity: BucketGranularity,
  cap = Infinity,
): string[] {
  const keys: string[] = [];
  if (from > to) return keys;
  const full = () => keys.length > cap;
  if (granularity === "hour") {
    const end = parseLocalDate(to);
    end.setHours(23);
    for (let t = parseLocalDate(from).getTime(); t <= end.getTime() && !full(); t += 3_600_000) {
      const key = formatLocalHourKey(new Date(t));
      if (keys[keys.length - 1] !== key) keys.push(key);
    }
    return keys;
  }
  if (granularity === "month") {
    const end = localMonthKey(to);
    const d = parseLocalDate(`${localMonthKey(from)}-01`);
    for (;;) {
      const key = localMonthKey(formatLocalDate(d));
      if (key > end || full()) return keys;
      keys.push(key);
      d.setMonth(d.getMonth() + 1);
    }
  }
  const stepDays = granularity === "week" ? 7 : 1;
  const d = parseLocalDate(granularity === "week" ? localWeekStart(from) : from);
  for (; formatLocalDate(d) <= to && !full(); d.setDate(d.getDate() + stepDays)) {
    keys.push(formatLocalDate(d));
  }
  return keys;
}
