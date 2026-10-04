/**
 * The PR graph's rows grouped by segment, with a roadmap row heading each and a segment folded
 * into one line on request.
 *
 * A segment is the run of PRs from a head down to the next fork: a head is a PR hanging straight
 * from the base branch or from a fork (a PR more than one PR stacks on), and the segment goes on
 * through every PR that is its parent's only child, ending at a fork or a top. The layout lists
 * rows in preorder (topDown over layoutGraph), so a segment's rows are always contiguous.
 *
 * Each segment is headed by a roadmap row naming the roadmaps its head's proposal belongs to —
 * on an unforked base that is the first PR's, and under a fork each branch's head brings its own.
 * Folding a segment (by clicking its roadmap row) draws the run as one line; the lanes go on
 * through it, so the graph above and below keeps its shape.
 */
import type { GraphRow } from "./pr-graph-model";

/** A roadmap as a segment's heading names it. */
export interface RoadmapRef {
  number: number;
  name: string;
  /** The roadmap's room, where its link leads; null while it has none. */
  channelId: string | null;
}

export type DisplayRow =
  | { kind: "node"; row: number }
  | {
      kind: "roadmap";
      /** The segment's key: its head node's key, stable across reloads. */
      segment: string;
      roadmaps: RoadmapRef[];
      /** PRs in the segment. */
      count: number;
      folded: boolean;
    }
  | { kind: "folded"; segment: string; count: number; lane: number };

export interface DisplayEdge {
  /** Display rows of the child and the parent. */
  from: number;
  to: number;
  lane: number;
  toLane: number;
  /** The layout row whose edge this is (its stacked flag and relation colour the line). */
  child: number;
}

export interface DisplayLayout {
  rows: DisplayRow[];
  edges: DisplayEdge[];
  /** Lanes each display row crosses (its own dot's, the edges through it, the bends into it). */
  widths: number[];
}

/** For each layout row, the rows hanging from it. */
function childrenOf(rows: readonly GraphRow[]): number[][] {
  const kids = rows.map(() => [] as number[]);
  rows.forEach((r, i) => {
    if (r.parentRow !== null) kids[r.parentRow]!.push(i);
  });
  return kids;
}

/** The segments, by head row: every head and the rows of its run, in order. */
export function segments(rows: readonly GraphRow[]): Map<number, number[]> {
  const kids = childrenOf(rows);
  const out = new Map<number, number[]>();
  rows.forEach((r, i) => {
    if (r.node === null || r.parentRow === null) return;
    const parent = rows[r.parentRow]!;
    const head = parent.node === null || kids[r.parentRow]!.length > 1;
    if (!head) return;
    const run = [i];
    for (let cur = i; kids[cur]!.length === 1;) {
      cur = kids[cur]![0]!;
      run.push(cur);
    }
    out.set(i, run);
  });
  return out;
}

/**
 * The rows to draw: each segment headed by its roadmap row, a folded one as a single line, and
 * the edges and widths for those rows. `roadmapsOf` names the roadmaps of a head row; `folded`
 * holds the head node keys of the folded segments.
 */
export function displayLayout(
  rows: readonly GraphRow[],
  roadmapsOf: (row: GraphRow) => RoadmapRef[],
  folded: ReadonlySet<string>,
): DisplayLayout {
  const runs = segments(rows);
  const out: DisplayRow[] = [];
  const at = new Array<number>(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const run = runs.get(i);
    if (run === undefined) {
      at[i] = out.length;
      out.push({ kind: "node", row: i });
      continue;
    }
    const key = rows[i]!.node!.key;
    const isFolded = folded.has(key);
    out.push({
      kind: "roadmap",
      segment: key,
      roadmaps: roadmapsOf(rows[i]!),
      count: run.length,
      folded: isFolded,
    });
    if (!isFolded) {
      at[i] = out.length;
      out.push({ kind: "node", row: i });
      continue;
    }
    const line = out.length;
    out.push({ kind: "folded", segment: key, count: run.length, lane: rows[i]!.lane });
    for (const r of run) at[r] = line;
    // A run is contiguous in preorder; the loop resumes after it.
    i = run[run.length - 1]!;
  }

  const edges: DisplayEdge[] = [];
  const seen = new Set<string>();
  rows.forEach((r, child) => {
    if (r.parentRow === null) return;
    const from = at[child]!;
    const to = at[r.parentRow]!;
    if (from === to) return;
    const key = `${from}:${to}:${r.lane}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ from, to, lane: r.lane, toLane: rows[r.parentRow]!.lane, child });
  });

  const widest = out.map((d) =>
    d.kind === "node" ? rows[d.row]!.lane : d.kind === "folded" ? d.lane : -1,
  );
  for (const e of edges) {
    const lo = Math.min(e.from, e.to);
    const hi = Math.max(e.from, e.to);
    for (let i = lo + 1; i < hi; i++) widest[i] = Math.max(widest[i]!, e.lane);
    widest[e.to] = Math.max(widest[e.to]!, e.lane);
  }
  return { rows: out, edges, widths: widest.map((w) => Math.max(w, 0) + 1) };
}
