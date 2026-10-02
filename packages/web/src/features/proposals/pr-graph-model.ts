/**
 * The PR graph's layout: the rows and lanes the graph page draws `GET …/proposals/graph` in.
 *
 * The server answers with a flat list of nodes, each naming the open PR its declared base leads to
 * (`parent`: a PR number, 0 for the base branch, null for neither — the server walks through
 * merged and closed PRs on the way) and whether that edge holds (`stacked`). `layoutGraph` lays it out
 * the way `git log --graph` draws history — newest at the top, the base branch at the bottom, one lane
 * per branch that is still open at that height — so a straight chain is one vertical line and a
 * fork is a second lane leaving the line where it forks. The page shows it turned over
 * (`topDown`): the base first and each stack's top last, the order a stack is built in.
 *
 * Which child continues its parent's lane: the one that leads to the chain's top when the server
 * named one, else a child on the chain, else a stacked one, else the taller subtree, else the
 * lower PR number. Every other child takes a lane to the right, and its whole subtree is laid out
 * before the continuing child, so a side branch sits between its fork point and the rest of the
 * chain and its lanes are free again above it.
 *
 * A node with no parent (its declared base leads to no open PR and not to the base branch), or
 * that is not reached from the base at all (a cycle of declarations), cannot be drawn; the page
 * lists it apart — which is not the same as off the chain.
 */
import type { ProposalGraphNode, ProposalGraphResponse } from "@prismshadow/penguin-server/api";

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
  /** Nodes the graph cannot draw: listed apart, in PR order. */
  detached: ProposalGraphNode[];
}

export function layoutGraph(nodes: readonly ProposalGraphNode[], top: number | null): GraphLayout {
  const byNumber = new Map(nodes.map((n) => [n.number, n]));
  // Children by parent key: 0 is the base branch.
  const children = new Map<number, ProposalGraphNode[]>();
  for (const n of nodes) {
    if (n.parent === null || (n.parent !== 0 && !byNumber.has(n.parent))) continue;
    if (n.parent === n.number) continue;
    const list = children.get(n.parent) ?? [];
    list.push(n);
    children.set(n.parent, list);
  }

  // Heights and "leads to the top", computed once per node, with a guard: declarations may
  // form a cycle, and a node already on the walk contributes nothing.
  const height = new Map<number, number>();
  const leadsToTop = new Map<number, boolean>();
  const measuring = new Set<number>();
  const measure = (key: number): void => {
    if (height.has(key) || measuring.has(key)) return;
    measuring.add(key);
    let h = 0;
    let reaches = key !== 0 && key === top;
    for (const c of children.get(key) ?? []) {
      measure(c.number);
      h = Math.max(h, height.get(c.number) ?? 0);
      reaches = reaches || (leadsToTop.get(c.number) ?? false);
    }
    measuring.delete(key);
    height.set(key, h + 1);
    leadsToTop.set(key, reaches);
  };
  measure(0);

  const ordered = (key: number): ProposalGraphNode[] =>
    [...(children.get(key) ?? [])].sort(
      (a, b) =>
        Number(leadsToTop.get(b.number) ?? false) - Number(leadsToTop.get(a.number) ?? false) ||
        Number(b.onChain) - Number(a.onChain) ||
        Number(b.stacked) - Number(a.stacked) ||
        (height.get(b.number) ?? 0) - (height.get(a.number) ?? 0) ||
        a.number - b.number,
    );

  // Laid out bottom-up (the base first), then reversed for display.
  const emitted: Array<{
    node: ProposalGraphNode | null;
    lane: number;
    parent: number | null;
    stacked: boolean;
  }> = [];
  const placed = new Set<number>();
  const emit = (
    node: ProposalGraphNode | null,
    lane: number,
    free: number,
    parent: number | null,
  ): number => {
    const key = node === null ? 0 : node.number;
    placed.add(key);
    const index = emitted.length;
    emitted.push({ node, lane, parent, stacked: node === null || node.stacked });
    const kids = ordered(key).filter((c) => !placed.has(c.number));
    if (kids.length === 0) return lane;
    const [main, ...sides] = kids;
    let widest = lane;
    let next = free;
    for (const side of sides) {
      if (placed.has(side.number)) continue;
      const used = emit(side, next, next + 1, index);
      widest = Math.max(widest, used);
      next = Math.max(used, next) + 1;
    }
    if (!placed.has(main!.number)) widest = Math.max(widest, emit(main!, lane, free, index));
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
  const detached = nodes.filter((n) => !placed.has(n.number)).sort((a, b) => a.number - b.number);
  return { rows, lanes: widest + 1, detached };
}

/**
 * Every stack's top: the server's `tops`, or its single `top` from a server older than that field.
 * Several stacks on the base branch each have one, so each is marked.
 */
export function graphTops(graph: Pick<ProposalGraphResponse, "top" | "tops">): number[] {
  if (graph.tops !== undefined) return graph.tops;
  return graph.top === null ? [] : [graph.top];
}

/**
 * How many stacks start on the base branch: its children that are on the chain. More than one is a
 * fork the graph keeps (several stacks side by side); one, with the base still forked, means a
 * branch at the base was not taken.
 */
export function baseStacks(nodes: readonly ProposalGraphNode[]): number {
  return nodes.filter((n) => n.parent === 0 && n.onChain).length;
}

/** The row showing a proposal's impl PR, or -1 when that proposal has no node on the graph. */
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
