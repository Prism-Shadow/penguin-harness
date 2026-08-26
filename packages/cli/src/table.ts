/**
 * Tiny fixed-width table renderer and relative-time formatter for the listing commands
 * (`ls`, `agent ls`, `project ls`, `cost --by`, `schedule ls`). Column widths follow the
 * widest cell; CJK display width is approximated as 2 columns per non-halfwidth code
 * point so zh titles keep the grid aligned.
 */

/** Approximate terminal display width (CJK and fullwidth forms count as 2). */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    width +=
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x20000 && code <= 0x3fffd)
        ? 2
        : 1;
  }
  return width;
}

function pad(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - displayWidth(text)));
}

/** Renders header + rows with two-space gutters; ends with a newline. */
export function renderTable(header: string[], rows: string[][]): string {
  const table = [header, ...rows];
  const widths = header.map((_, col) =>
    Math.max(...table.map((row) => displayWidth(row[col] ?? ""))),
  );
  const line = (row: string[]): string =>
    row
      .map((cell, col) => (col === row.length - 1 ? cell : pad(cell, widths[col]!)))
      .join("  ")
      .trimEnd();
  return `${table.map(line).join("\n")}\n`;
}

/**
 * Compact relative time for list rows ("now", "5m", "3h", "2d", else yyyy-mm-dd) —
 * digits + a unit letter, deliberately language-neutral.
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const seconds = Math.floor((now.getTime() - then) / 1000);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 14 * 86400) return `${Math.floor(seconds / 86400)}d`;
  return new Date(then).toISOString().slice(0, 10);
}
