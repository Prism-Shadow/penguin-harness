/**
 * The file tree's DOM-free logic, shared by every browser that draws one row per entry: the
 * shape of a row, where a row's subtree ends in the flat row list, and the keyboard step of
 * the WAI-ARIA tree pattern.
 *
 * How the rows are produced is the caller's business and deliberately not modelled here — the
 * Workspace panel lists one directory per level as it is opened, the plugin browser groups a
 * flat listing it already holds — so a row states everything the tree needs to draw it.
 */

/** Indent per nesting level, in px. */
export const TREE_INDENT_PX = 14;

/** One rendered tree row: an entry, where it sits, and a directory's open/loaded state. */
export interface FileTreeRow {
  path: string;
  name: string;
  kind: "dir" | "file";
  /** Nesting depth; a root-level entry is 0. */
  depth: number;
  /** 1-based position among its own directory's entries, and how many there are: the row list
   *  is flat, so each row has to state its own set rather than infer it from its container. */
  posInSet: number;
  setSize: number;
  /** Directory rows: whether it is open. */
  expanded: boolean;
  /** Directory rows: whether its children are on hand (a lazily listed directory is not, while it loads). */
  loaded: boolean;
  /** Directory rows: loaded and holding nothing. */
  empty: boolean;
}

/**
 * Where the row at `i` stops owning what follows it: the index of the first later row at its
 * own depth or shallower, or the end of the list. The rows in `(i, end)` are its descendants,
 * which is what lets the flat row list be drawn as nested containers.
 */
export function subtreeEnd(rows: readonly FileTreeRow[], i: number): number {
  const depth = rows[i]?.depth;
  if (depth === undefined) return rows.length;
  for (let j = i + 1; j < rows.length; j += 1) if (rows[j]!.depth <= depth) return j;
  return rows.length;
}

/** What one navigation key does to the tree: move focus, open a directory, or close one. */
export interface TreeKeyAction {
  focus?: string;
  expand?: string;
  collapse?: string;
}

/**
 * The keyboard step for `key` with `focused` as the current row (null: none yet), or null
 * when the key is not a tree key or has nothing to do.
 *   - ArrowDown / ArrowUp move within the rows on screen (clamped at the ends); with no
 *     focused row either lands on the first row.
 *   - ArrowRight opens a closed directory, steps into the first child of an open one.
 *   - ArrowLeft closes an open directory, otherwise steps out to the parent row.
 *   - Home / End jump to the first / last row.
 */
export function treeKeyStep(
  rows: readonly FileTreeRow[],
  focused: string | null,
  key: string,
): TreeKeyAction | null {
  if (rows.length === 0) return null;
  const first = rows[0]!;
  const index = focused === null ? -1 : rows.findIndex((r) => r.path === focused);
  const row = index >= 0 ? rows[index]! : null;
  switch (key) {
    case "ArrowDown":
      return { focus: rows[Math.min(rows.length - 1, index + 1)]!.path };
    case "ArrowUp":
      return { focus: rows[Math.max(0, index - 1)]!.path };
    case "Home":
      return { focus: first.path };
    case "End":
      return { focus: rows[rows.length - 1]!.path };
    case "ArrowRight": {
      if (row === null) return { focus: first.path };
      if (row.kind !== "dir") return null;
      if (!row.expanded) return { expand: row.path };
      const next = rows[index + 1];
      return next !== undefined && next.depth > row.depth ? { focus: next.path } : null;
    }
    case "ArrowLeft": {
      if (row === null) return null;
      if (row.kind === "dir" && row.expanded) return { collapse: row.path };
      // The parent is the nearest earlier row above this one's depth. Derived from the rows
      // rather than from the path, because a row's path need not name a row: the plugin
      // browser's top-level rows are `skills/<name>`, and there is no `skills` row to step to.
      for (let i = index - 1; i >= 0; i -= 1) {
        if (rows[i]!.depth < row.depth) return { focus: rows[i]!.path };
      }
      return null;
    }
    default:
      return null;
  }
}
