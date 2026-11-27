/**
 * The PR graph's rows in the order the page draws them. The server lays the rows out in Sapling's
 * smartlog shape (`graph.rows`: newest on top, a line forking off a node drawn right above it in
 * the column to its right, joining back with `├─╯`, the base branch last); the page draws them
 * the other way up — the base branch on top, each PR under the one it stacks on — so the list
 * built here runs from the server's last row to its first. Each row keeps the server's cells, and
 * GraphCells (pr-graph-lanes.tsx) mirrors them vertically, so `├─╯` is drawn as `├─╮`.
 *
 * Rows are grouped by segment, a roadmap row heading each, and a segment folds into one line on
 * request. A segment is the run of PRs from a head up to the next fork: a head is a PR hanging
 * straight from the base branch or from a fork (a PR more than one PR stacks on), and the segment
 * goes on through every PR that is its parent's only child, ending at a fork or a top. In the
 * smartlog order a run is contiguous — an only child is drawn right above its parent — so its
 * rows are one block, the run's top first and its head last; drawn, the head comes first.
 *
 * The heading sits right above the run's head as drawn, between the head and the row the server
 * put under it, and carries the lines that pass that boundary. Folding a segment (by clicking its
 * heading) draws the run as one line in the run's column; the lines in the other columns go on
 * through it.
 */
import type { ProposalGraphNode, ProposalGraphRow } from "@prismshadow/penguin-server/api";

/** A roadmap as a segment's heading names it. */
export interface RoadmapRef {
  number: number;
  name: string;
  /** The roadmap's room, where its link leads; null while it has none. */
  channelId: string | null;
}

/** The glyph a folded run is drawn with in its column (the page draws it as a capsule). */
export const FOLDED_GLYPH = "┆";

export type DisplayRow =
  | { kind: "row"; row: ProposalGraphRow }
  | {
      kind: "roadmap";
      /** The segment's key: its head node's key, stable across reloads. */
      segment: string;
      roadmaps: RoadmapRef[];
      /** PRs in the segment. */
      count: number;
      folded: boolean;
      cells: string[];
    }
  | { kind: "folded"; segment: string; count: number; cells: string[] };

/** The cells of any display row. */
export function cellsOf(d: DisplayRow): string[] {
  return d.kind === "row" ? d.row.cells : d.cells;
}

/**
 * Whether a cell's line goes on to the next older row (the row below in the server's layout,
 * above it as drawn): a line, a node, a join's `├`, the fold.
 */
export function connectsDown(cell: string | undefined): boolean {
  const g = cell?.[0];
  return g !== undefined && g !== " " && g !== "╯" && g !== "~";
}

/**
 * For each display row (in drawn order) and column, whether a line comes into it from the next
 * newer row — the row drawn right below it, above it in the server's layout. GraphCells draws
 * that line on the row's newer side.
 */
export function linesFromNewer(rows: readonly DisplayRow[]): boolean[][] {
  return rows.map((d, i) => {
    const newer = i === rows.length - 1 ? [] : cellsOf(rows[i + 1]!);
    return cellsOf(d).map((_, c) => connectsDown(newer[c]));
  });
}

/**
 * The segments, by the row index of each run's top: the row indices of the run, top first, the
 * head last. `nodes` are the graph's nodes, which say who stacks on whom.
 */
export function segments(
  rows: readonly ProposalGraphRow[],
  nodes: ReadonlyArray<Pick<ProposalGraphNode, "key" | "parent">>,
): Map<number, number[]> {
  const at = new Map<string, number>();
  rows.forEach((r, i) => {
    if (r.kind === "node") at.set(r.key, i);
  });
  const kids = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.parent === null || !at.has(n.key)) continue;
    kids.set(n.parent, [...(kids.get(n.parent) ?? []), n.key]);
  }
  const out = new Map<number, number[]>();
  for (const n of nodes) {
    if (n.parent === null || !at.has(n.key)) continue;
    const head = n.parent === "" || (kids.get(n.parent)?.length ?? 0) > 1;
    if (!head) continue;
    const run = [n.key];
    const seen = new Set(run);
    for (let cur = n.key; kids.get(cur)?.length === 1;) {
      cur = kids.get(cur)![0]!;
      if (seen.has(cur)) break;
      seen.add(cur);
      run.push(cur);
    }
    const indices = run.map((k) => at.get(k)!).reverse();
    out.set(indices[0]!, indices);
  }
  return out;
}

/**
 * The rows to draw, base on top: the server's rows from its last to its first, each segment
 * headed by its roadmap row right above the segment's head and a folded one drawn as a single
 * line. `roadmapsOf` names the roadmaps of a segment's head node; `folded` holds the head node
 * keys of the folded segments.
 */
export function displayRows(
  rows: readonly ProposalGraphRow[],
  nodes: readonly ProposalGraphNode[],
  roadmapsOf: (head: ProposalGraphNode) => RoadmapRef[],
  folded: ReadonlySet<string>,
): DisplayRow[] {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  // The runs by their head's row index: walking the rows base first, the head is a run's start.
  const byHead = new Map<number, number[]>();
  for (const run of segments(rows, nodes).values()) byHead.set(run[run.length - 1]!, run);
  const out: DisplayRow[] = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const run = byHead.get(i);
    if (run === undefined) {
      out.push({ kind: "row", row: rows[i]! });
      continue;
    }
    const head = rows[i]!;
    const segment = head.key;
    const isFolded = folded.has(segment);
    // Between the head and the older row drawn above it pass exactly the lines the head carries
    // on toward the base: its own line down to its parent and the other columns' lines.
    const cells = head.cells.map((cell) => (connectsDown(cell) ? "│ " : "  "));
    out.push({
      kind: "roadmap",
      segment,
      roadmaps: roadmapsOf(byKey.get(segment)!),
      count: run.length,
      folded: isFolded,
      cells,
    });
    if (!isFolded) {
      out.push({ kind: "row", row: head });
      continue;
    }
    const col = head.cells.length - 1;
    out.push({
      kind: "folded",
      segment,
      count: run.length,
      cells: head.cells.map((cell, c) => (c === col ? `${FOLDED_GLYPH} ` : cell)),
    });
    // A run is contiguous; the loop resumes past its top.
    i = run[0]!;
  }
  return out;
}
