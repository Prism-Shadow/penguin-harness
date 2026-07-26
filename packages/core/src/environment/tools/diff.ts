/**
 * Unified-diff rendering for the file tools' outputs (edit_file / write_file), modeled on
 * git's presentation: `@@ -oldStart,oldCount +newStart,newCount @@` hunk headers, ` `
 * context lines, `-` removed and `+` added lines, 3 lines of context, nearby changes
 * merged into one hunk.
 *
 * Two hunk builders share the renderer:
 * - `buildReplacementHunks` (edit_file): exact by construction — the replacement sites are
 *   known, so each hunk is derived by re-applying the replacement to the affected line
 *   region; no diff algorithm, cost independent of file size.
 * - `buildLineDiffHunks` (write_file): a real line diff (LCS over the middle remaining
 *   after common prefix/suffix trimming) for arbitrary old/new contents, with a size guard
 *   that falls back to a `+X/−Y` summary when the middle is too large to diff cheaply.
 *
 * Display safety: diff lines are capped in length and trailing `\r` is stripped (a raw CR
 * would glitch terminal rendering); CRLF-vs-LF differences therefore do not show as
 * whole-file rewrites in the display, while counts stay based on the true content.
 */

/** Context lines shown on each side of a change (git default). */
export const DIFF_CONTEXT_LINES = 3;

/** Max characters kept of a single diff line; the rest is replaced by a truncation marker. */
const MAX_DIFF_LINE_LENGTH = 2000;

/** DP cell cap for the LCS line diff: above this the write_file diff falls back to a summary. */
const MAX_LCS_CELLS = 250_000;

/** One unified hunk: header numbers plus already-prefixed (` `/`-`/`+`) display lines. */
export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

/** Caps a diff line for display and strips a trailing `\r` (CRLF files). */
function capDiffLine(prefix: string, content: string): string {
  const noCr = content.endsWith("\r") ? content.slice(0, -1) : content;
  const capped =
    noCr.length > MAX_DIFF_LINE_LENGTH
      ? `${noCr.slice(0, MAX_DIFF_LINE_LENGTH)}… [line truncated]`
      : noCr;
  return `${prefix}${capped}`;
}

/** Renders one hunk in git's unified format (a count of 0 backs the start up by one, as git does). */
export function renderHunk(h: DiffHunk): string {
  const oldStart = h.oldCount === 0 ? h.oldStart - 1 : h.oldStart;
  const newStart = h.newCount === 0 ? h.newStart - 1 : h.newStart;
  return [`@@ -${oldStart},${h.oldCount} +${newStart},${h.newCount} @@`, ...h.lines].join("\n");
}

/** Splits content into lines the way git counts them: a trailing newline terminates the last line instead of adding an empty one. */
export function contentLines(content: string): string[] {
  if (content === "") return [];
  const lines = content.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** 1-based line number containing the character at `pos` (a newline belongs to the line it terminates). */
function lineOfChar(content: string, pos: number): number {
  let line = 1;
  for (let i = 0; i < pos && i < content.length; i += 1) {
    if (content.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

/** Char offset where 1-based line `line` starts. */
function lineStartOffset(content: string, line: number): number {
  let current = 1;
  for (let i = 0; i < content.length; i += 1) {
    if (current === line) return i;
    if (content.charCodeAt(i) === 10) current += 1;
  }
  return content.length;
}

/** Char offset just past the end of 1-based line `line` (including its terminating newline when present). */
function lineEndOffset(content: string, line: number): number {
  const start = lineStartOffset(content, line);
  const nl = content.indexOf("\n", start);
  return nl === -1 ? content.length : nl + 1;
}

export interface ReplacementDiff {
  /** Hunks in file order, each with the number of replacement occurrences it covers. */
  hunks: { hunk: DiffHunk; sites: number }[];
}

/**
 * Builds unified hunks for edit_file: one hunk per replacement site, with sites whose
 * context ranges touch merged into a single hunk. Each hunk's `+` side is derived by
 * re-applying the replacement to the affected region, so it is exact by construction
 * (including several occurrences on one line). `maxHunks` caps the output; each hunk
 * reports how many occurrences it covers so the caller can note the uncovered rest.
 */
export function buildReplacementHunks(
  oldContent: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
  maxHunks: number,
): ReplacementDiff {
  // Occurrence positions in the old content (non-overlapping, left to right).
  const positions: number[] = [];
  let idx = oldContent.indexOf(oldString);
  while (idx !== -1) {
    positions.push(idx);
    if (!replaceAll) break;
    idx = oldContent.indexOf(oldString, idx + oldString.length);
  }
  const oldLines = contentLines(oldContent);
  const total = oldLines.length;

  // Line range touched by each site, then merge sites whose context ranges touch.
  const ranges = positions.map((pos) => {
    const a1 = lineOfChar(oldContent, pos);
    const a2 = lineOfChar(oldContent, pos + Math.max(0, oldString.length - 1));
    return { a1, a2, sites: 1 };
  });
  const merged: { a1: number; a2: number; sites: number }[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.a1 - DIFF_CONTEXT_LINES <= last.a2 + DIFF_CONTEXT_LINES) {
      last.a2 = Math.max(last.a2, r.a2);
      last.sites += r.sites;
    } else {
      merged.push({ ...r });
    }
  }

  const hunks: { hunk: DiffHunk; sites: number }[] = [];
  let lineDelta = 0; // Cumulative new-minus-old line shift from earlier hunks
  for (const region of merged) {
    if (hunks.length >= maxHunks) break;
    // Exact regional replacement: extract the affected whole-line region and re-apply.
    const regionText = oldContent.slice(
      lineStartOffset(oldContent, region.a1),
      lineEndOffset(oldContent, region.a2),
    );
    const newRegionText = regionText.split(oldString).join(newString);
    let minus = contentLines(regionText);
    let plus = contentLines(newRegionText);
    // Shared leading/trailing lines become context instead of noise.
    let leadShift = 0;
    while (minus.length > 0 && plus.length > 0 && minus[0] === plus[0]) {
      minus = minus.slice(1);
      plus = plus.slice(1);
      leadShift += 1;
    }
    let tailShift = 0;
    while (
      minus.length > 0 &&
      plus.length > 0 &&
      minus[minus.length - 1] === plus[plus.length - 1]
    ) {
      minus = minus.slice(0, -1);
      plus = plus.slice(0, -1);
      tailShift += 1;
    }
    const changeStart = region.a1 + leadShift; // First old line actually changed
    const changeEnd = region.a2 - tailShift;
    const preFrom = Math.max(1, changeStart - DIFF_CONTEXT_LINES);
    const postTo = Math.min(total, changeEnd + DIFF_CONTEXT_LINES);
    const lines: string[] = [];
    for (let n = preFrom; n < changeStart; n += 1) lines.push(capDiffLine(" ", oldLines[n - 1]!));
    for (const l of minus) lines.push(capDiffLine("-", l));
    for (const l of plus) lines.push(capDiffLine("+", l));
    for (let n = changeEnd + 1; n <= postTo; n += 1) lines.push(capDiffLine(" ", oldLines[n - 1]!));
    const contextCount = changeStart - preFrom + (postTo - changeEnd);
    hunks.push({
      hunk: {
        oldStart: preFrom,
        oldCount: contextCount + minus.length,
        newStart: preFrom + lineDelta,
        newCount: contextCount + plus.length,
        lines,
      },
      sites: region.sites,
    });
    lineDelta += plus.length - minus.length;
  }
  return { hunks };
}

export type LineDiffResult =
  | { kind: "hunks"; hunks: DiffHunk[]; plus: number; minus: number }
  | { kind: "too-large"; plus: number; minus: number }
  | { kind: "identical" };

/**
 * Line diff between two full contents (write_file overwrite): trims the common
 * prefix/suffix, LCS-diffs the middle, and groups changes into context-3 hunks. When the
 * middle is too large to diff cheaply, reports the middle sizes as a `+X/−Y` summary
 * instead.
 */
export function buildLineDiffHunks(oldContent: string, newContent: string): LineDiffResult {
  if (oldContent === newContent) return { kind: "identical" };
  const a = contentLines(oldContent);
  const b = contentLines(newContent);
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const midA = a.slice(prefix, a.length - suffix);
  const midB = b.slice(prefix, b.length - suffix);
  if (midA.length * midB.length > MAX_LCS_CELLS) {
    return { kind: "too-large", plus: midB.length, minus: midA.length };
  }

  // LCS table over the middles, then backtrack into per-line ops.
  const n = midA.length;
  const m = midB.length;
  const width = m + 1;
  const table = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        midA[i] === midB[j]
          ? table[(i + 1) * width + j + 1]! + 1
          : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }
  // Ops over the middle region: "keep" advances both sides, "del"/"ins" one side.
  const ops: ("keep" | "del" | "ins")[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (midA[i] === midB[j]) {
      ops.push("keep");
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) {
      ops.push("del");
      i += 1;
    } else {
      ops.push("ins");
      j += 1;
    }
  }
  while (i < n) {
    ops.push("del");
    i += 1;
  }
  while (j < m) {
    ops.push("ins");
    j += 1;
  }

  // Group changed ops into hunks with DIFF_CONTEXT_LINES of context (merging when the
  // context ranges touch). Walk ops tracking old/new line cursors over the FULL files.
  interface Pending {
    startOld: number; // 1-based old line of the first display line
    startNew: number;
    lines: string[];
    oldCount: number;
    newCount: number;
    plus: number;
    minus: number;
    trailingContext: number;
  }
  const hunks: DiffHunk[] = [];
  let totalPlus = 0;
  let totalMinus = 0;
  let pending: Pending | null = null;
  let oldLine = prefix + 1; // 1-based cursors positioned at the middle's start
  let newLine = prefix + 1;
  // Context ring of the most recent unchanged lines before a change.
  const ring: { text: string; oldLine: number; newLine: number }[] = [];

  const flush = (): void => {
    if (!pending) return;
    // Drop surplus trailing context beyond the window.
    while (pending.trailingContext > DIFF_CONTEXT_LINES) {
      pending.lines.pop();
      pending.oldCount -= 1;
      pending.newCount -= 1;
      pending.trailingContext -= 1;
    }
    hunks.push({
      oldStart: pending.startOld,
      oldCount: pending.oldCount,
      newStart: pending.startNew,
      newCount: pending.newCount,
      lines: pending.lines,
    });
    pending = null;
  };

  const ensurePending = (): Pending => {
    if (pending) {
      pending.trailingContext = 0;
      return pending;
    }
    const ctx = ring.slice(-DIFF_CONTEXT_LINES);
    pending = {
      startOld: ctx.length > 0 ? ctx[0]!.oldLine : oldLine,
      startNew: ctx.length > 0 ? ctx[0]!.newLine : newLine,
      lines: ctx.map((c) => capDiffLine(" ", c.text)),
      oldCount: ctx.length,
      newCount: ctx.length,
      plus: 0,
      minus: 0,
      trailingContext: 0,
    };
    return pending;
  };

  const onKeep = (text: string): void => {
    if (pending) {
      if (pending.trailingContext >= 2 * DIFF_CONTEXT_LINES) {
        // Far enough from the last change: close the hunk (surplus context trimmed in
        // flush; the trimmed lines are not re-fed into the ring, so two changes 8-13
        // lines apart may show slightly less than full leading context on the second
        // hunk — a presentation nuance only, the numbers stay exact).
        flush();
        ring.length = 0;
      } else {
        pending.lines.push(capDiffLine(" ", text));
        pending.oldCount += 1;
        pending.newCount += 1;
        pending.trailingContext += 1;
      }
    }
    if (!pending) {
      ring.push({ text, oldLine, newLine });
      if (ring.length > DIFF_CONTEXT_LINES) ring.shift();
    }
    oldLine += 1;
    newLine += 1;
  };

  // Prefix/suffix lines are unchanged context feeding the ring only near the middle;
  // seed the ring with the tail of the common prefix.
  for (let k = Math.max(0, prefix - DIFF_CONTEXT_LINES); k < prefix; k += 1) {
    ring.push({ text: a[k]!, oldLine: k + 1, newLine: k + 1 });
  }

  let ai = prefix;
  let bi = prefix;
  for (const op of ops) {
    if (op === "keep") {
      onKeep(a[ai]!);
      ai += 1;
      bi += 1;
    } else if (op === "del") {
      const h = ensurePending();
      h.lines.push(capDiffLine("-", a[ai]!));
      h.oldCount += 1;
      h.minus += 1;
      totalMinus += 1;
      ai += 1;
      oldLine += 1;
    } else {
      const h = ensurePending();
      h.lines.push(capDiffLine("+", b[bi]!));
      h.newCount += 1;
      h.plus += 1;
      totalPlus += 1;
      bi += 1;
      newLine += 1;
    }
  }
  // Trailing suffix lines: at most the context window matters.
  for (let k = 0; k < Math.min(suffix, DIFF_CONTEXT_LINES + 1); k += 1) {
    onKeep(a[a.length - suffix + k]!);
  }
  flush();
  return { kind: "hunks", hunks, plus: totalPlus, minus: totalMinus };
}
