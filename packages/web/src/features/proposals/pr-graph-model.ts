/**
 * The PR graph's layout: the rows and lanes the graph page draws `GET …/proposals/graph` in.
 *
 * The server answers with a flat list of nodes — open PRs, and impl branches no PR is open on yet
 * — each keyed by its head branch and naming the node its declared base leads to (`parent`: a
 * node's key, `""` for the base branch, null for neither — the server walks through merged and
 * closed PRs on the way) and whether that edge holds (`stacked`). `layoutGraph` lays it out
 * the way `git log --graph` draws history — newest at the top, the base branch at the bottom, one lane
 * per branch that is still open at that height — so a straight chain is one vertical line and a
 * fork is a second lane leaving the line where it forks. The page shows it turned over
 * (`topDown`): the base first and each stack's top last, the order a stack is built in.
 *
 * Which child continues its parent's lane: the one that leads to the chain's top when the server
 * named one, else a child on the chain, else a stacked one, else the taller subtree, else the
 * order the server listed them in. Every other child takes a lane to the right, and its whole subtree is laid out
 * before the continuing child, so a side branch sits between its fork point and the rest of the
 * chain and its lanes are free again above it.
 *
 * A node with no parent (its declared base leads to no open PR and not to the base branch), or
 * that is not reached from the base at all (a cycle of declarations), cannot be drawn; the page
 * lists it apart — which is not the same as off the chain.
 */
import type { ProposalGraphNode } from "@prismshadow/penguin-server/api";

/** The key that names the base branch wherever a node's key is expected. */
const BASE = "";

/** One row of the drawn graph, top to bottom. `node` is null for the base branch (the last row). */
export interface GraphRow {
  node: ProposalGraphNode | null;
  lane: number;
  /** The row this one is drawn hanging from (its parent's), or null for the base. */
  parentRow: number | null;
  /** Whether the edge to the parent holds (the server's `stacked`): drawn solid, else dashed. */
  stacked: boolean;
}

export interface GraphLayout {
  rows: GraphRow[];
  /** How many lanes the widest height uses (at least 1). */
  lanes: number;
  /** Nodes the graph cannot draw: listed apart, in the server's order. */
  detached: ProposalGraphNode[];
}

export function layoutGraph(nodes: readonly ProposalGraphNode[], top: string | null): GraphLayout {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const rank = new Map(nodes.map((n, i) => [n.key, i]));
  // Children by parent key: "" is the base branch.
  const children = new Map<string, ProposalGraphNode[]>();
  for (const n of nodes) {
    if (n.parent === null || (n.parent !== BASE && !byKey.has(n.parent))) continue;
    if (n.parent === n.key) continue;
    const list = children.get(n.parent) ?? [];
    list.push(n);
    children.set(n.parent, list);
  }

  // Heights and "leads to the top", computed once per node, with a guard: declarations may
  // form a cycle, and a node already on the walk contributes nothing.
  const height = new Map<string, number>();
  const leadsToTop = new Map<string, boolean>();
  const measuring = new Set<string>();
  const measure = (key: string): void => {
    if (height.has(key) || measuring.has(key)) return;
    measuring.add(key);
    let h = 0;
    let reaches = key !== BASE && key === top;
    for (const c of children.get(key) ?? []) {
      measure(c.key);
      h = Math.max(h, height.get(c.key) ?? 0);
      reaches = reaches || (leadsToTop.get(c.key) ?? false);
    }
    measuring.delete(key);
    height.set(key, h + 1);
    leadsToTop.set(key, reaches);
  };
  measure(BASE);

  const ordered = (key: string): ProposalGraphNode[] =>
    [...(children.get(key) ?? [])].sort(
      (a, b) =>
        Number(leadsToTop.get(b.key) ?? false) - Number(leadsToTop.get(a.key) ?? false) ||
        Number(b.onChain) - Number(a.onChain) ||
        Number(b.stacked) - Number(a.stacked) ||
        (height.get(b.key) ?? 0) - (height.get(a.key) ?? 0) ||
        rank.get(a.key)! - rank.get(b.key)!,
    );

  // Laid out bottom-up (the base first), then reversed for display.
  const emitted: Array<{
    node: ProposalGraphNode | null;
    lane: number;
    parent: number | null;
    stacked: boolean;
  }> = [];
  const placed = new Set<string>();
  const emit = (
    node: ProposalGraphNode | null,
    lane: number,
    free: number,
    parent: number | null,
  ): number => {
    const key = node === null ? BASE : node.key;
    placed.add(key);
    const index = emitted.length;
    emitted.push({ node, lane, parent, stacked: node === null || node.stacked });
    const kids = ordered(key).filter((c) => !placed.has(c.key));
    if (kids.length === 0) return lane;
    const [main, ...sides] = kids;
    let widest = lane;
    let next = free;
    for (const side of sides) {
      if (placed.has(side.key)) continue;
      const used = emit(side, next, next + 1, index);
      widest = Math.max(widest, used);
      next = Math.max(used, next) + 1;
    }
    if (!placed.has(main!.key)) widest = Math.max(widest, emit(main!, lane, free, index));
    return widest;
  };
  const widest = emit(null, 0, 1, null);

  const last = emitted.length - 1;
  const rows: GraphRow[] = emitted
    .map((e) => ({
      node: e.node,
      lane: e.lane,
      parentRow: e.parent === null ? null : last - e.parent,
      stacked: e.stacked,
    }))
    .reverse();
  const detached = nodes.filter((n) => !placed.has(n.key));
  return { rows, lanes: widest + 1, detached };
}

/**
 * How many stacks start on the base branch: its children that are on the chain. More than one is a
 * fork the graph keeps (several stacks side by side); one, with the base still forked, means a
 * branch at the base was not taken.
 */
export function baseStacks(nodes: readonly ProposalGraphNode[]): number {
  return nodes.filter((n) => n.parent === BASE && n.onChain).length;
}

/** How a node is named in a sentence or a label: `#n` for a PR, its head branch for a branch node. */
export function nodeRef(node: Pick<ProposalGraphNode, "number" | "branch">): string {
  return node.number === null ? node.branch : `#${node.number}`;
}

/**
 * What a deploy from a node names: its PR, or — a branch node, which always has a proposal —
 * the proposal whose impl branch it is (the deploy resolves that branch's tip). Null for neither.
 */
export function deployTarget(
  node: Pick<ProposalGraphNode, "number" | "proposal">,
): { pr: number } | { proposal: number } | null {
  if (node.number !== null) return { pr: node.number };
  return node.proposal === null ? null : { proposal: node.proposal.number };
}

/** The row showing a proposal's impl (its PR or its branch), or -1 when that proposal has no node on the graph. */
export function rowOfProposal(rows: readonly GraphRow[], proposal: number): number {
  return rows.findIndex((r) => r.node?.proposal?.number === proposal);
}

/** The `?proposal=<n>` a proposal's page opens the graph with, or null when absent or not a number. */
export function focusedProposal(params: URLSearchParams): number | null {
  const raw = params.get("proposal");
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** A deploy's extra arguments as typed in the graph's deploy dialog: split at whitespace, nothing empty. */
export function splitArgs(text: string): string[] {
  return text.split(/\s+/).filter((a) => a !== "");
}

/**
 * How many lanes each row actually crosses — its own dot's, and every edge passing through it
 * (an edge runs down the child's lane to the row above its parent, then bends into the parent's
 * lane). A row's text starts after its own lanes, the way `git log --graph` indents: a short
 * stack forking near the base no longer pushes every row above it to the right.
 */
export function rowWidths(rows: readonly GraphRow[]): number[] {
  const widest = rows.map((r) => r.lane);
  rows.forEach((row, child) => {
    if (row.parentRow === null) return;
    // Either direction: the edge runs the child's lane on every row between the two, and its
    // bend into the parent's lane sits in the parent's own row — so the parent's text starts
    // after that lane too, or it is drawn across the curve.
    const lo = Math.min(child, row.parentRow);
    const hi = Math.max(child, row.parentRow);
    for (let i = lo + 1; i < hi; i++) {
      widest[i] = Math.max(widest[i]!, row.lane);
    }
    widest[row.parentRow] = Math.max(widest[row.parentRow]!, row.lane);
  });
  return widest.map((w) => w + 1);
}

/**
 * The layout turned over for reading top-down: the base branch first, each stack below it, its
 * top last — the order a stack is built in. Parent rows are renumbered to match; lanes stay.
 */
export function topDown(layout: GraphLayout): GraphLayout {
  const last = layout.rows.length - 1;
  return {
    ...layout,
    rows: layout.rows
      .map((r) => ({ ...r, parentRow: r.parentRow === null ? null : last - r.parentRow }))
      .reverse(),
  };
}

/**
 * The drawn graph's measures, in rem: the theme's text size sets the root font-size, so the
 * rows, lanes and dots grow and shrink with the text they sit beside. `graphGeometry` turns
 * them into the px the SVG needs for one root font-size.
 */
const ROW_REM = 3.75;
const LANE_REM = 1;
const DOT_REM = 0.28;
const TEXT_GAP_REM = 0.625;
/** A roadmap heading or a folded run: a line shorter than a PR's two. */
const HEAD_REM = 2.25;

export interface GraphGeometry {
  row: number;
  /** A roadmap heading's and a folded run's height. */
  head: number;
  lane: number;
  dot: number;
  textGap: number;
  laneX: (lane: number) => number;
  rowY: (row: number) => number;
  /**
   * One edge, drawn from the child's dot to its parent's: straight when they share a lane,
   * otherwise along the child's lane and bending into the parent's lane right beside the parent.
   */
  edgePath: (child: number, childLane: number, parent: number, parentLane: number) => string;
}

export function graphGeometry(remPx: number): GraphGeometry {
  const row = ROW_REM * remPx;
  const lane = LANE_REM * remPx;
  const laneX = (l: number): number => l * lane + lane / 2 + 2;
  const rowY = (r: number): number => r * row + row / 2;
  return {
    row,
    head: HEAD_REM * remPx,
    lane,
    dot: DOT_REM * remPx,
    textGap: TEXT_GAP_REM * remPx,
    laneX,
    rowY,
    edgePath: (child, childLane, parent, parentLane) => {
      const x1 = laneX(childLane);
      const y1 = rowY(child);
      const x2 = laneX(parentLane);
      const y2 = rowY(parent);
      if (x1 === x2) return `M${x1} ${y1}V${y2}`;
      // The bend sits beside the parent, on the child's side: above it when the child is drawn
      // above (bottom-up), below it when the child is drawn below (top-down).
      const dir = child < parent ? -1 : 1;
      const bend = y2 + (dir * row) / 2;
      return `M${x1} ${y1}V${bend}C${x1} ${y2 + (dir * row) / 6} ${x2} ${bend - (dir * row) / 6} ${x2} ${y2}`;
    },
  };
}

/**
 * Whether a merged proposal stays out of the graph's lists by default. A merged proposal whose
 * impl PR is still a layer on the chain stays drawn (the layer is real work on the stack); one
 * that is off the chain, undrawable, or has no open impl PR is finished business, and listing it
 * beside the live problems only reads as one. The page folds these into a "merged" line.
 */
export function foldedAsMerged(status: string | null | undefined): boolean {
  return status === "merged";
}
