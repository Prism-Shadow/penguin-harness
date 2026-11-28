/**
 * Tiny fixed-width table renderer and relative-time formatter for the listing commands
 * (`ls`, `agent ls`, `project ls`, `cost --by`, `schedule ls`). Column widths follow the
 * widest cell; CJK display width is approximated as 2 columns per non-halfwidth code
 * point so zh titles keep the grid aligned. The renderer itself lives in the CLI face, where
 * a shipped plugin's CLI module reaches it too.
 */
import { formatLocalDate } from "../internal/dates.js";

export { displayWidth, renderTable } from "@prismshadow/penguin-library-cli/table";

/**
 * Compact relative time for list rows ("now", "5m", "3h", "2d", else yyyy-mm-dd) —
 * digits + a unit letter, deliberately language-neutral. The date is the reader's own
 * calendar day, the one `--days` counts in: the instant is a `...Z` stamp, and its date part
 * names the UTC day — a row last active at 07:00 on the 31st in UTC+8 would read as the 30th.
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const seconds = Math.floor((now.getTime() - then) / 1000);
  if (seconds < 0) return formatLocalDate(new Date(then));
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 14 * 86400) return `${Math.floor(seconds / 86400)}d`;
  return formatLocalDate(new Date(then));
}

/** Converts a token count to a human-readable abbreviation: 1234->1.2k, 1500000->1.5M, 2e9->2B, <1000 unchanged. */
export function humanizeTokens(n: number): string {
  const abs = Math.abs(n);
  if (abs < 1000) return `${n}`;
  // The unit is picked from the rounded value, not the raw one: 999950 renders as `1000.0` k at
  // one decimal, which has to carry into `1M` rather than print `1000k`.
  if (fitsThousand(n / 1000)) return `${trimZero(n / 1000)}k`;
  if (fitsThousand(n / 1_000_000)) return `${trimZero(n / 1_000_000)}M`;
  return `${trimZero(n / 1_000_000_000)}B`;
}

/** True while the one-decimal rendering of `v` stays under 1000: 999.94 does, 999.95 does not. */
function fitsThousand(v: number): boolean {
  return Math.abs(Number(v.toFixed(1))) < 1000;
}

/** Keeps one decimal place but drops a trailing `.0`. */
function trimZero(v: number): string {
  const s = v.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}
