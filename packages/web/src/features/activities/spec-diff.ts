/**
 * The line diff behind the specification editor's review view: what the editor holds
 * against what was last saved. There is no version control for a draft specification,
 * so "the last saved specification" is the only base there is, and it is the one an
 * author is deciding about before pressing save.
 *
 * Pure, so the counts, the regions and the changed scenes an author reads all come from
 * one computation rather than three approximations of it.
 */

export type DiffKind = "same" | "added" | "removed";

export interface DiffRow {
  kind: DiffKind;
  /** 1-based line number in the saved text, absent for an added line. */
  before?: number;
  /** 1-based line number in the edited text, absent for a removed line. */
  after?: number;
  text: string;
}

/**
 * The most table cells the match may build. The cost is the product of the two line
 * counts, not either one, and this recomputes on every keystroke while the review is
 * open, so the guard has to be on the product rather than on either length.
 *
 * A million cells covers a thousand lines against a thousand, which is far longer than
 * an activity specification, and costs a few milliseconds per keystroke. The sixteen
 * million a pair of four-thousand-line texts would need does not, and is refused.
 */
export const DIFF_CELL_LIMIT = 1_000_000;

function splitLines(text: string): string[] {
  return text.length ? text.replace(/\r\n/g, "\n").split("\n") : [];
}

/**
 * A longest-common-subsequence diff, which is what makes a moved block read as
 * unchanged context rather than as a delete and an insert.
 *
 * The table is quadratic, so a pair of texts whose product of line counts passes
 * `DIFF_CELL_LIMIT` falls back to reporting the whole text as replaced. That is honest
 * and bounded: the alternative is a table of millions of cells built during typing.
 */
export function diffLines(saved: string, edited: string): DiffRow[] {
  const before = splitLines(saved);
  const after = splitLines(edited);
  if (before.length * after.length > DIFF_CELL_LIMIT)
    return [
      ...before.map((text, index) => ({ kind: "removed" as const, before: index + 1, text })),
      ...after.map((text, index) => ({ kind: "added" as const, after: index + 1, text })),
    ];
  // lengths[i][j] is the LCS length of before[i..] and after[j..].
  const lengths: number[][] = Array.from({ length: before.length + 1 }, () =>
    new Array<number>(after.length + 1).fill(0),
  );
  for (let i = before.length - 1; i >= 0; i -= 1)
    for (let j = after.length - 1; j >= 0; j -= 1)
      lengths[i]![j] =
        before[i] === after[j]
          ? lengths[i + 1]![j + 1]! + 1
          : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      rows.push({ kind: "same", before: i + 1, after: j + 1, text: before[i]! });
      i += 1;
      j += 1;
    } else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!) {
      rows.push({ kind: "removed", before: i + 1, text: before[i]! });
      i += 1;
    } else {
      rows.push({ kind: "added", after: j + 1, text: after[j]! });
      j += 1;
    }
  }
  for (; i < before.length; i += 1) rows.push({ kind: "removed", before: i + 1, text: before[i]! });
  for (; j < after.length; j += 1) rows.push({ kind: "added", after: j + 1, text: after[j]! });
  return rows;
}

export interface DiffRegion {
  /** Index of the first changed row, into the array `diffLines` returned. */
  start: number;
  /** Index one past the last changed row. */
  end: number;
}

/** Runs of adjacent changed rows, which is what "next change" steps between. */
export function diffRegions(rows: readonly DiffRow[]): DiffRegion[] {
  const regions: DiffRegion[] = [];
  let start = -1;
  for (const [index, row] of rows.entries()) {
    if (row.kind === "same") {
      if (start >= 0) regions.push({ start, end: index });
      start = -1;
    } else if (start < 0) start = index;
  }
  if (start >= 0) regions.push({ start, end: rows.length });
  return regions;
}

export interface DiffStats {
  added: number;
  removed: number;
  regions: number;
}

export function diffStats(rows: readonly DiffRow[]): DiffStats {
  return {
    added: rows.filter((row) => row.kind === "added").length,
    removed: rows.filter((row) => row.kind === "removed").length,
    regions: diffRegions(rows).length,
  };
}

/** Which region a step lands on, wrapping at both ends so navigation never dead-ends. */
export function stepRegion(current: number, count: number, direction: 1 | -1): number {
  if (count <= 0) return -1;
  if (current < 0) return direction === 1 ? 0 : count - 1;
  return (current + direction + count) % count;
}

/** Only context this many lines either side of a change; the rest is folded away. */
export const DIFF_CONTEXT = 3;

/**
 * Rows worth showing: every change, plus a little context. Long unchanged stretches
 * collapse to a gap, because a specification is mostly unchanged and scrolling through
 * it to find the edit is the thing the view exists to avoid.
 */
export function visibleRows(rows: readonly DiffRow[]): { row: DiffRow; index: number }[] {
  const keep = new Set<number>();
  for (const region of diffRegions(rows))
    for (
      let index = Math.max(0, region.start - DIFF_CONTEXT);
      index < Math.min(rows.length, region.end + DIFF_CONTEXT);
      index += 1
    )
      keep.add(index);
  return [...keep]
    .sort((left, right) => left - right)
    .map((index) => ({ row: rows[index]!, index }));
}

function sceneMap(text: string): Map<string, string> {
  const scenes = new Map<string, string>();
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const list = parsed?.scenes ?? parsed?.stages;
    if (!Array.isArray(list)) return scenes;
    for (const [index, scene] of list.entries()) {
      if (!scene || typeof scene !== "object") continue;
      const id = typeof scene.id === "string" && scene.id ? scene.id : `#${index + 1}`;
      scenes.set(id, JSON.stringify(scene));
    }
  } catch {
    // Unparseable edits are still diffable as text; they simply name no scenes.
  }
  return scenes;
}

export type SceneChange = "added" | "removed" | "changed";

/**
 * The scenes that differ, so an author can see which parts of the activity an edit
 * touched without reading the lines. Unparseable text names none rather than guessing.
 */
export function changedScenes(
  saved: string,
  edited: string,
): { id: string; change: SceneChange }[] {
  const before = sceneMap(saved);
  const after = sceneMap(edited);
  const changes: { id: string; change: SceneChange }[] = [];
  for (const [id, body] of after)
    if (!before.has(id)) changes.push({ id, change: "added" });
    else if (before.get(id) !== body) changes.push({ id, change: "changed" });
  for (const id of before.keys()) if (!after.has(id)) changes.push({ id, change: "removed" });
  return changes;
}

/**
 * Where a chip should jump. The scene's `id` line is often unchanged and therefore
 * folded away, so a chip resolves to the nearest rendered row: the first changed row at
 * or after the scene's own line, falling back to the last change before it. Returning a
 * folded index would make the chip silently do nothing.
 */
export function sceneRowIndex(rows: readonly DiffRow[], sceneId: string): number {
  const needle = `"id": ${JSON.stringify(sceneId)}`;
  const line = rows.findIndex((row) => row.text.includes(needle));
  const rendered = new Set(visibleRows(rows).map((entry) => entry.index));
  if (line >= 0 && rendered.has(line)) return line;
  const after = rows.findIndex((row, index) => index >= line && row.kind !== "same");
  if (line >= 0 && after >= 0) return after;
  const changes = [...rendered].filter((index) => rows[index]!.kind !== "same");
  if (line < 0) return changes[0] ?? -1;
  return changes.filter((index) => index < line).pop() ?? changes[0] ?? -1;
}
