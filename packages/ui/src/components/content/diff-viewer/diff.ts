/**
 * The diff viewer's model, as pure functions: a line diff of two texts (or a unified patch read as
 * given) grouped into hunks, the changed words of each paired line, the side-by-side rows of a
 * split view, and the per-line markup a highlighter's output splits into.
 *
 * The line diff is Myers' O(ND) algorithm over the lines between the common head and tail, so an
 * edit costs time in proportion to its size, not the file's. Its trace grows with the square of
 * the edit distance, so past {@link MAX_EDIT} changed lines the middle is shown as replaced
 * outright — a diff that large reads as "rewritten", not line by line.
 */
import type { CodeMark } from "../code-block/highlight-options";

export type DiffLineKind = "context" | "add" | "del";

/** A character range `[start, end)` of a line, in UTF-16 offsets. */
export type WordRange = readonly [start: number, end: number];

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  /** 1-based number in the old text; null for an added line. */
  oldNo: number | null;
  /** 1-based number in the new text; null for a removed line. */
  newNo: number | null;
  /**
   * The line's index in the side it is drawn from — the old side for a removed line, the new side
   * for an added or a context line — which is where its highlighted markup is found.
   */
  at: number;
  /** The words that changed against the paired line on the other side; empty when unpaired. */
  words: readonly WordRange[];
}

export interface DiffHunk {
  /** The `@@ -a,b +c,d @@` line, with any section heading a patch carried after it. */
  header: string;
  lines: readonly DiffLine[];
}

export interface DiffModel {
  hunks: readonly DiffHunk[];
  /** The old side's lines in order (context and removed): what the highlighter reads for it. */
  oldSide: readonly string[];
  /** The new side's lines in order (context and added). */
  newSide: readonly string[];
}

/** Changed lines past which the middle of a diff is drawn as replaced whole. */
export const MAX_EDIT = 1000;

/** The class a changed word carries, in the highlighted markup and the plain fallback alike. */
export const DIFF_WORD_CLASS = "diff-word";

/** A text's lines: CRLF read as LF, and a final newline ending the last line, not opening one. */
export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

type Edit = "equal" | "insert" | "delete";

const run = (length: number, edit: Edit): Edit[] => Array<Edit>(length).fill(edit);

/**
 * The shortest edit script from `a` to `b`, one entry per element: `equal` consumes one of each,
 * `delete` one of `a`, `insert` one of `b`. When the edit distance exceeds `limit`, the part
 * between the common head and tail is `replaced` (all deleted, then all inserted) — or, without
 * that fallback, the answer is null.
 */
export function editScript<T>(
  a: readonly T[],
  b: readonly T[],
  limit = MAX_EDIT,
  fallback: "replace" | "none" = "replace",
): Edit[] | null {
  // The common head and tail cost nothing and are most of a typical edit.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  const middle =
    myers(midA, midB, limit) ??
    (fallback === "replace"
      ? [...run(midA.length, "delete"), ...run(midB.length, "insert")]
      : null);
  if (middle === null) return null;
  return [...run(head, "equal"), ...middle, ...run(tail, "equal")];
}

function myers<T>(a: readonly T[], b: readonly T[], limit: number): Edit[] | null {
  const n = a.length;
  const m = b.length;
  if (n === 0) return run(m, "insert");
  if (m === 0) return run(n, "delete");
  const max = Math.min(n + m, limit);
  // v[k + offset] is the furthest x reached on diagonal k; the offset keeps negative k in range.
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const at = (k: number) => v[k + offset] ?? 0;
  // Before each step, the diagonals it reads (-d-1 … d+1), so the trace grows with the square of
  // the edit distance rather than with the distance times the input.
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? at(k + 1) : at(k - 1) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[k + offset] = x;
      if (x >= n && y >= m) return backtrack(trace, n, m);
    }
  }
  return null;
}

function backtrack(trace: readonly Int32Array[], n: number, m: number): Edit[] {
  const edits: Edit[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const snapshot = trace[d]!;
    const at = (k: number) => snapshot[k + d + 1] ?? 0;
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      edits.push("equal");
      x--;
      y--;
    }
    if (d > 0) edits.push(x === prevX ? "insert" : "delete");
    x = prevX;
    y = prevY;
  }
  return edits.reverse();
}

/**
 * Word tokens: one Han or kana character (CJK runs have no spaces to split on), a run of other
 * letters, digits and underscores, a run of spaces, or one other character. Every character falls
 * in exactly one, so the tokens concatenate back to the line.
 */
const WORD =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|(?:(?![\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])[\p{L}\p{N}_])+|\s+|[^\p{L}\p{N}_\s]/gu;

/**
 * The changed words of a removed line and the added line it is paired with, as ranges of each.
 * Nothing is marked when too little is shared — below 40% of the longer line, a word diff marks
 * most of the line and reads as noise, so the line's own wash says enough.
 */
export function changedWords(
  before: string,
  after: string,
): { removed: WordRange[]; added: WordRange[] } {
  const none = { removed: [], added: [] };
  if (before === after) return none;
  const a = before.match(WORD) ?? [];
  const b = after.match(WORD) ?? [];
  const script = editScript(a, b, 500, "none");
  if (script === null) return none;
  const removed: WordRange[] = [];
  const added: WordRange[] = [];
  let i = 0;
  let j = 0;
  let aAt = 0;
  let bAt = 0;
  let shared = 0;
  const push = (ranges: WordRange[], start: number, end: number) => {
    const last = ranges[ranges.length - 1];
    // Adjacent changed words join into one range, so the highlight is one run, not a stripe.
    if (last !== undefined && last[1] === start) ranges[ranges.length - 1] = [last[0], end];
    else ranges.push([start, end]);
  };
  for (const edit of script) {
    if (edit === "equal") {
      const token = a[i++]!;
      j++;
      if (token.trim() !== "") shared += token.length;
      aAt += token.length;
      bAt += token.length;
    } else if (edit === "delete") {
      const token = a[i++]!;
      push(removed, aAt, aAt + token.length);
      aAt += token.length;
    } else {
      const token = b[j++]!;
      push(added, bAt, bAt + token.length);
      bAt += token.length;
    }
  }
  if (shared < 0.4 * Math.max(before.trim().length, after.trim().length)) return none;
  return { removed, added };
}

/** Pairs each run of removed lines with the run of added lines right after it, and marks their words. */
function markWords(lines: DiffLine[]): void {
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.kind !== "del") {
      i++;
      continue;
    }
    const delStart = i;
    while (i < lines.length && lines[i]!.kind === "del") i++;
    const addStart = i;
    while (i < lines.length && lines[i]!.kind === "add") i++;
    const pairs = Math.min(addStart - delStart, i - addStart);
    for (let p = 0; p < pairs; p++) {
      const del = lines[delStart + p]!;
      const add = lines[addStart + p]!;
      const words = changedWords(del.text, add.text);
      lines[delStart + p] = { ...del, words: words.removed };
      lines[addStart + p] = { ...add, words: words.added };
    }
  }
}

function hunkHeader(lines: readonly DiffLine[], oldBefore: number, newBefore: number): string {
  const oldCount = lines.filter((l) => l.kind !== "add").length;
  const newCount = lines.filter((l) => l.kind !== "del").length;
  // An empty side names the line it sits after, as `diff -u` does.
  const oldStart = oldCount === 0 ? oldBefore : oldBefore + 1;
  const newStart = newCount === 0 ? newBefore : newBefore + 1;
  return `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;
}

/** The side arrays and each line's index in its side, assigned in reading order. */
function withSides(hunks: { header: string; lines: DiffLine[] }[]): DiffModel {
  const oldSide: string[] = [];
  const newSide: string[] = [];
  const out: DiffHunk[] = hunks.map((hunk) => ({
    header: hunk.header,
    lines: hunk.lines.map((line) => {
      let at: number;
      if (line.kind === "del") {
        at = oldSide.length;
        oldSide.push(line.text);
      } else {
        if (line.kind === "context") oldSide.push(line.text);
        at = newSide.length;
        newSide.push(line.text);
      }
      return { ...line, at };
    }),
  }));
  return { hunks: out, oldSide, newSide };
}

/**
 * The diff of two texts, in hunks with `context` unchanged lines around each change (two changes
 * closer than twice that share a hunk). Identical texts have no hunks.
 */
export function diffTexts(before: string, after: string, context = 3): DiffModel {
  const a = splitLines(before);
  const b = splitLines(after);
  const script = editScript(a, b) ?? [];
  const all: DiffLine[] = [];
  let i = 0;
  let j = 0;
  for (const edit of script) {
    if (edit === "equal") {
      all.push({ kind: "context", text: b[j]!, oldNo: i + 1, newNo: j + 1, at: 0, words: [] });
      i++;
      j++;
    } else if (edit === "delete") {
      all.push({ kind: "del", text: a[i]!, oldNo: i + 1, newNo: null, at: 0, words: [] });
      i++;
    } else {
      all.push({ kind: "add", text: b[j]!, oldNo: null, newNo: j + 1, at: 0, words: [] });
      j++;
    }
  }
  // Group: every change keeps `context` lines either side; overlapping windows merge.
  const hunks: { header: string; lines: DiffLine[] }[] = [];
  let k = 0;
  while (k < all.length) {
    if (all[k]!.kind === "context") {
      k++;
      continue;
    }
    const start = Math.max(0, k - context);
    let end = k;
    for (let scan = k; scan < all.length; scan++) {
      if (all[scan]!.kind !== "context") end = scan;
      else if (scan - end > 2 * context) break;
    }
    const stop = Math.min(all.length, end + context + 1);
    const lines = all.slice(start, stop);
    markWords(lines);
    let oldBefore = 0;
    let newBefore = 0;
    for (const line of all.slice(0, start)) {
      if (line.kind !== "add") oldBefore++;
      if (line.kind !== "del") newBefore++;
    }
    hunks.push({ header: hunkHeader(lines, oldBefore, newBefore), lines });
    k = stop;
  }
  return withSides(hunks);
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * A unified patch read as given: its hunks, their headers verbatim, and the file headers and
 * `\ No newline at end of file` notes around them dropped. Several files' hunks run on in order.
 */
export function parsePatch(patch: string): DiffModel {
  const hunks: { header: string; lines: DiffLine[] }[] = [];
  let current: { header: string; lines: DiffLine[] } | null = null;
  let oldNo = 0;
  let newNo = 0;
  let oldLeft = 0;
  let newLeft = 0;
  for (const raw of patch.replace(/\r\n?/g, "\n").split("\n")) {
    const header = HUNK_HEADER.exec(raw);
    if (header !== null) {
      current = { header: raw, lines: [] };
      hunks.push(current);
      oldNo = Number(header[1]);
      newNo = Number(header[3]);
      oldLeft = header[2] === undefined ? 1 : Number(header[2]);
      newLeft = header[4] === undefined ? 1 : Number(header[4]);
      continue;
    }
    // Outside a hunk, or past the lines its header counted: file headers and trailing text.
    if (current === null || (oldLeft <= 0 && newLeft <= 0)) continue;
    if (raw.startsWith("\\")) continue;
    const sign = raw[0];
    const text = raw.slice(1);
    if (sign === "+") {
      current.lines.push({ kind: "add", text, oldNo: null, newNo, at: 0, words: [] });
      newNo++;
      newLeft--;
    } else if (sign === "-") {
      current.lines.push({ kind: "del", text, oldNo, newNo: null, at: 0, words: [] });
      oldNo++;
      oldLeft--;
    } else {
      // A context line; an editor that strips trailing spaces leaves an empty one bare.
      current.lines.push({ kind: "context", text, oldNo, newNo, at: 0, words: [] });
      oldNo++;
      newNo++;
      oldLeft--;
      newLeft--;
    }
  }
  for (const hunk of hunks) markWords(hunk.lines);
  return withSides(hunks);
}

/** One row of a split view: the old line on the left, the new on the right, either may be absent. */
export interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

/**
 * A hunk's rows side by side: a context line on both sides, and a run of removed lines beside the
 * run of added lines that follows it, row for row, the shorter run padded with empty cells.
 */
export function splitRows(lines: readonly DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.kind === "context") {
      rows.push({ left: line, right: line });
      i++;
      continue;
    }
    const dels: DiffLine[] = [];
    while (i < lines.length && lines[i]!.kind === "del") dels.push(lines[i++]!);
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i]!.kind === "add") adds.push(lines[i++]!);
    for (let r = 0; r < Math.max(dels.length, adds.length); r++) {
      rows.push({ left: dels[r] ?? null, right: adds[r] ?? null });
    }
  }
  return rows;
}

/**
 * The marks a side's changed words become for the highlighter: one per word range, on the line's
 * index in that side.
 */
export function wordMarks(model: DiffModel, kind: "add" | "del"): CodeMark[] {
  return model.hunks.flatMap((hunk) =>
    hunk.lines
      .filter((line) => line.kind === kind)
      .flatMap((line) =>
        line.words.map(([start, end]) => ({
          line: line.at,
          start,
          end,
          className: DIFF_WORD_CLASS,
        })),
      ),
  );
}

/**
 * Highlighted markup cut into its lines' inner markup, or null when it does not have the shape a
 * block-lines highlight produces (a `<code>` of `<span class="line">` elements) or the count is
 * not `expected`.
 */
export function splitHighlightedLines(html: string, expected: number): string[] | null {
  const open = html.indexOf("<code>");
  const close = html.lastIndexOf("</code>");
  if (open === -1 || close < open) return null;
  const parts = html.slice(open + "<code>".length, close).split(/<span class="line(?: [^"]*)?">/);
  if (parts.shift() !== "") return null;
  const lines = parts.map((part) => (part.endsWith("</span>") ? part.slice(0, -7) : part));
  return lines.length === expected ? lines : null;
}
