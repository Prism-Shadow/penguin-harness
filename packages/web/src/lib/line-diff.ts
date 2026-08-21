/**
 * Line-level diff for the chat memory view's change display: LCS over lines, rendered as a
 * flat run of kept/added/removed rows (no hunk splitting — the inputs are an edit tool's
 * old/new snippets, i.e. already just the changed region, or a whole rewritten memory topic
 * file, which is small by construction).
 *
 * Deliberately local to the Web App: core's environment/tools/diff.ts is not part of the
 * SDK's public surface, and widening that contract for a rendering concern isn't warranted.
 */

export type DiffLineType = "same" | "add" | "del";

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

/** Split into lines the way a reader counts them: a trailing newline ends the last line rather than opening an empty one. */
function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Above this DP-table size the quadratic LCS is skipped and the diff degrades to full removal + full addition. */
const MAX_LCS_CELLS = 200_000;

/**
 * Diffs two texts line-by-line: removals first within each changed run (the unified-diff
 * reading order). Inputs beyond `MAX_LCS_CELLS` fall back to "all old removed, all new added"
 * rather than stalling the render thread.
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  if (a.length === 0 && b.length === 0) return [];
  if (a.length * b.length > MAX_LCS_CELLS) {
    return [
      ...a.map((text): DiffLine => ({ type: "del", text })),
      ...b.map((text): DiffLine => ({ type: "add", text })),
    ];
  }

  // Classic LCS length table; (m+1) x (n+1), walked back to emit the aligned rows.
  const m = a.length;
  const n = b.length;
  const width = n + 1;
  const table = new Uint32Array((m + 1) * width);
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1]! + 1
          : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i]! });
      i++;
      j++;
    } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) {
      out.push({ type: "del", text: a[i]! });
      i++;
    } else {
      out.push({ type: "add", text: b[j]! });
      j++;
    }
  }
  while (i < m) out.push({ type: "del", text: a[i++]! });
  while (j < n) out.push({ type: "add", text: b[j++]! });
  return out;
}
