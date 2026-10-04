/**
 * The PR graph's rows as the page draws them: the server's rows (`graph.rows`, Sapling's
 * smartlog shape — newest on top, a line forking off a node drawn right above it in the column
 * to its right, joining back with `├─╯`, the base branch last) grouped by segment, with a roadmap
 * row heading each and a segment folded into one line on request.
 *
 * A segment is the run of PRs from a head up to the next fork: a head is a PR hanging straight
 * from the base branch or from a fork (a PR more than one PR stacks on), and the segment goes on
 * through every PR that is its parent's only child, ending at a fork or a top. In the smartlog
 * order a run is contiguous — an only child is drawn right above its parent — so its rows are
 * one block, the run's top first and its head last.
 *
 * The heading sits right above the run's top. Folding a segment (by clicking its heading) draws
 * the run as one line in the run's column; the lines in the other columns go on through it.
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

/** Whether a cell's line goes on into the row below: a line, a node, a join's `├`, the fold. */
export function connectsDown(cell: string | undefined): boolean {
  const g = cell?.[0];
  return g !== undefined && g !== " " && g !== "╯" && g !== "~";
}

/** For each display row and column, whether a line comes into it from the row above. */
export function linesFromAbove(rows: readonly DisplayRow[]): boolean[][] {
  return rows.map((d, i) => {
    const above = i === 0 ? [] : cellsOf(rows[i - 1]!);
    return cellsOf(d).map((_, c) => connectsDown(above[c]));
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
 * The rows to draw: the server's rows, each segment headed by its roadmap row and a folded one
 * drawn as a single line. `roadmapsOf` names the roadmaps of a segment's head node; `folded`
 * holds the head node keys of the folded segments.
 */
export function displayRows(
  rows: readonly ProposalGraphRow[],
  nodes: readonly ProposalGraphNode[],
  roadmapsOf: (head: ProposalGraphNode) => RoadmapRef[],
  folded: ReadonlySet<string>,
): DisplayRow[] {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const runs = segments(rows, nodes);
  const out: DisplayRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const run = runs.get(i);
    if (run === undefined) {
      out.push({ kind: "row", row: rows[i]! });
      continue;
    }
    const head = rows[run[run.length - 1]!]!;
    const segment = head.key;
    const isFolded = folded.has(segment);
    // The heading carries on the lines that come down into the run's top, and nothing else.
    const above = out.length === 0 ? [] : cellsOf(out[out.length - 1]!);
    const cells = rows[i]!.cells.map((_, c) => (connectsDown(above[c]) ? "│ " : "  "));
    out.push({
      kind: "roadmap",
      segment,
      roadmaps: roadmapsOf(byKey.get(segment)!),
      count: run.length,
      folded: isFolded,
      cells,
    });
    if (!isFolded) {
      out.push({ kind: "row", row: rows[i]! });
      continue;
    }
    const col = head.cells.length - 1;
    out.push({
      kind: "folded",
      segment,
      count: run.length,
      cells: head.cells.map((cell, c) => (c === col ? `${FOLDED_GLYPH} ` : cell)),
    });
    // A run is contiguous; the loop resumes after its head.
    i = run[run.length - 1]!;
  }
  return out;
}
