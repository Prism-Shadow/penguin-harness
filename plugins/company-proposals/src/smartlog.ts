/**
 * The PR graph drawn the way Sapling's smartlog and `jj log` draw a stack (Sapling's renderdag
 * layout): top-down, newest on top, the base branch a last row `~`. A node's main line — the
 * child that leads to the chain's top, else one on the chain, else a stacked one, else the
 * taller, else the first in graph order — continues in the node's own column above it. Every
 * other child's line is drawn in the column to its right, right above the node, and joins back
 * into it with `├─╯`; several lines on one node are drawn one after another, each with its own
 * join, never fanning out from one point:
 *
 *     ○  web-mod-7
 *     ○  web-mod-6
 *     │ ○  plugins-page
 *     ├─╯
 *     │ ○  port-forwards
 *     ├─╯
 *     ○  web-mod-1
 *     ~  main
 *
 * The graph is a tree (a node has one parent), so renderdag's column assignment reduces to this
 * walk: a column is taken by a side line only between its parent's main line and its join, and
 * every column to its left carries a line through it. One function lays the rows out, as glyph
 * cells two characters wide; the CLI prints them as they are and the page draws the same cells
 * in a monospace grid, so the two never disagree on the shape. A node no line from the base
 * reaches (no parent, a cycle of declarations) has no row: both list it apart. `ownRows` lays out
 * the organization's own part the same way.
 */
import type { ProposalGraphNode, ProposalGraphRow } from "@prismshadow/penguin-server/api";
import { BASE_KEY } from "./graph-heads.js";

/** The node glyphs: on the chain, off it with its edge holding, its edge not holding. */
export const GLYPH = { on: "○", off: "◌", broken: "×", base: "~" } as const;

const THROUGH = "│ ";

type Drawn = Pick<
  ProposalGraphNode,
  "key" | "parent" | "stacked" | "onChain" | "stale" | "behind" | "proposal"
>;

/**
 * The rows of the graph, top to bottom, the base branch last. `top` is the chain's top, when one;
 * `connectors` the nodes drawn only to carry a proposal's line down to the base (ownRows).
 */
export function smartlogRows(
  nodes: readonly Drawn[],
  top: string | null,
  connectors: ReadonlySet<string> = new Set(),
): ProposalGraphRow[] {
  const rank = new Map(nodes.map((n, i) => [n.key, i]));
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const children = new Map<string, Drawn[]>();
  for (const n of nodes) {
    if (n.parent === null || n.parent === n.key) continue;
    if (n.parent !== BASE_KEY && !byKey.has(n.parent)) continue;
    children.set(n.parent, [...(children.get(n.parent) ?? []), n]);
  }

  // Heights and "leads to the top", once per node; a node already on the walk adds nothing
  // (the declarations may form a cycle the base does not reach, but a guard costs nothing).
  const height = new Map<string, number>();
  const leadsToTop = new Map<string, boolean>();
  const measuring = new Set<string>();
  const measure = (key: string): void => {
    if (height.has(key) || measuring.has(key)) return;
    measuring.add(key);
    let h = 0;
    let reaches = key !== BASE_KEY && key === top;
    for (const c of children.get(key) ?? []) {
      measure(c.key);
      h = Math.max(h, height.get(c.key) ?? 0);
      reaches = reaches || (leadsToTop.get(c.key) ?? false);
    }
    measuring.delete(key);
    height.set(key, h + 1);
    leadsToTop.set(key, reaches);
  };
  measure(BASE_KEY);
  const ordered = (key: string): Drawn[] =>
    [...(children.get(key) ?? [])].sort(
      (a, b) =>
        Number(leadsToTop.get(b.key) ?? false) - Number(leadsToTop.get(a.key) ?? false) ||
        Number(b.onChain) - Number(a.onChain) ||
        Number(b.stacked) - Number(a.stacked) ||
        (height.get(b.key) ?? 0) - (height.get(a.key) ?? 0) ||
        rank.get(a.key)! - rank.get(b.key)!,
    );

  const glyph = (n: Drawn): string => (n.onChain ? GLYPH.on : n.stacked ? GLYPH.off : GLYPH.broken);
  const prefix = (col: number): string[] => Array.from({ length: col }, () => THROUGH);
  const placed = new Set<string>();
  // Top-down: a node's main line first (above it), then each side line with its join, then the
  // node itself.
  const rowsOf = (key: string, col: number, out: ProposalGraphRow[]): void => {
    placed.add(key);
    const kids = ordered(key).filter((c) => !placed.has(c.key));
    const [main, ...sides] = kids;
    if (main !== undefined) rowsOf(main.key, col, out);
    for (const side of sides) {
      rowsOf(side.key, col + 1, out);
      out.push({
        kind: "join",
        key,
        cells: [...prefix(col), "├─", "╯ "],
        behind: null,
        connector: false,
      });
    }
    if (key === BASE_KEY) {
      // The base: how far it moved on since the main line's bottom layer was built.
      const bottom = main === undefined ? undefined : byKey.get(main.key);
      const behind = bottom?.stale === true ? (bottom.behind ?? null) : null;
      out.push({ kind: "base", key, cells: [`${GLYPH.base} `], behind, connector: false });
    } else {
      out.push({
        kind: "node",
        key,
        cells: [...prefix(col), `${glyph(byKey.get(key)!)} `],
        behind: null,
        connector: connectors.has(key),
      });
    }
  };
  const rows: ProposalGraphRow[] = [];
  rowsOf(BASE_KEY, 0, rows);
  return rows;
}

/**
 * The organization's own part of the graph: the delivery repository carries everyone's open PRs,
 * and most are no business of the organization's. Drawn are the nodes that carry one of its
 * proposals, and below each, down to the base, the nodes without one its line needs (an upstream
 * PR a proposal's impl is stacked on) — those as `connector`s, drawn faded. Display alone: the
 * chain was decided over every node before this.
 */
export function ownRows(nodes: readonly Drawn[], top: string | null): ProposalGraphRow[] {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const keep = new Set<string>();
  const connectors = new Set<string>();
  for (const n of nodes) {
    if (n.proposal === null) continue;
    keep.add(n.key);
    // Down the parents to the base; `keep` guards a cycle of declared bases.
    for (let at = n.parent; at !== null && at !== BASE_KEY && !keep.has(at);) {
      const below = byKey.get(at);
      if (below === undefined) break;
      keep.add(at);
      if (below.proposal === null) connectors.add(at);
      at = below.parent;
    }
  }
  const own = nodes.filter((n) => keep.has(n.key));
  return smartlogRows(own, top !== null && keep.has(top) ? top : null, connectors);
}
