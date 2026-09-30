/**
 * The PR graph's layout: the rows and lanes the graph page draws `GET …/proposals/graph` in.
 *
 * The server answers with a flat list of nodes, each naming the PR it is declared to stack on
 * (`parent`: a PR number, 0 for the base branch, null for neither). The page draws it the way
 * `git log --graph` draws history — newest at the top, the base branch at the bottom, one lane
 * per branch that is still open at that height — so a straight chain is one vertical line and a
 * fork is a second lane leaving the line where it forks.
 *
 * Which child continues its parent's lane: the one that leads to the chain's top when the server
 * named one, else a stacked child before one off the chain, else the taller subtree, else the
 * lower PR number. Every other child takes a lane to the right, and its whole subtree is laid out
 * before the continuing child, so a side branch sits between its fork point and the rest of the
 * chain and its lanes are free again above it.
 *
 * A node whose declared parent is not in the graph (a closed PR's branch), or that is not reached
 * from the base at all (a cycle of declarations), is not placed; the page lists it apart.
 */
import type { ProposalGraphNode, ProposalGraphRelation } from "@prismshadow/penguin-server/api";

/** One row of the drawn graph, top to bottom. `node` is null for the base branch (the last row). */
export interface GraphRow {
  node: ProposalGraphNode | null;
  lane: number;
  /** The row this one is drawn hanging from (its parent's), or null for the base. */
  parentRow: number | null;
  /** Whether the edge to the parent is stacked (the head contains the parent's) or off the chain. */
  stacked: boolean;
}

export interface GraphLayout {
  rows: GraphRow[];
  /** How many lanes the widest height uses (at least 1). */
  lanes: number;
  /** Nodes the graph could not place: listed apart, in PR order. */
  detached: ProposalGraphNode[];
}

/** A relation that keeps a layer on the chain: its head contains its declared base's head. */
export function isStacked(relation: ProposalGraphRelation): boolean {
  return relation === "ahead" || relation === "same";
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
        Number(isStacked(b.relation)) - Number(isStacked(a.relation)) ||
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
    emitted.push({ node, lane, parent, stacked: node === null || isStacked(node.relation) });
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
