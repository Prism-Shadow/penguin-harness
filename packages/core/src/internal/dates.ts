/** Local-timezone date formatting (internal shared helper, not exported via the barrel). */

/** Format a date as local `yyyy-mm-dd` (local timezone, 4-digit year, zero-padded 2-digit month/day). */
export function formatLocalDate(date: Date): string {
  const year = date.getFullYear().toString().padStart(4, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}
