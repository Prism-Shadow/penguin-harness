/**
 * Where the Files panel editor's caret goes when its text changes under it, and where it starts:
 * the positions a code editor keeps by line and column rather than by character offset. Pure, so
 * the editor's two layout effects stay a few lines each and the arithmetic is tested directly.
 */

/** The offset of the start of line `line` (0-based) in `text`, clamped to its last line. */
export function lineStartOffset(text: string, line: number): number {
  let offset = 0;
  for (let i = 0; i < line; i += 1) {
    const next = text.indexOf("\n", offset);
    if (next < 0) return offset;
    offset = next + 1;
  }
  return offset;
}

/**
 * Where a caret at `offset` in `before` lands once the text is `after`: the same line and
 * column, pulled back to the last line and to the end of its line where `after` is shorter.
 * What a code editor does when the file changes on disk under a clean buffer — the reader
 * keeps their place instead of being thrown to the end.
 */
export function caretAfterReplace(before: string, after: string, offset: number): number {
  const at = Math.max(0, Math.min(offset, before.length));
  const head = before.slice(0, at);
  const line = head.split("\n").length - 1;
  const column = at - (head.lastIndexOf("\n") + 1);
  const start = lineStartOffset(after, line);
  const end = after.indexOf("\n", start);
  const lineLength = (end < 0 ? after.length : end) - start;
  return start + Math.min(column, lineLength);
}
