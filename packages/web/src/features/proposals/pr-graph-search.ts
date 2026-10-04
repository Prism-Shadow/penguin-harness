/**
 * Searching the PR graph, and choosing which part of it is drawn — the pure half, so it runs in
 * the node-only tests; use-graph-view.ts holds the page's state around it.
 *
 * A query matches a PR number (`#213`, or `213` alone), a proposal number (`proposal 194`,
 * `p194`, or `194` alone), or — as text, ignoring case — a branch name, a PR title or a proposal
 * title. The hits come in the order the full graph draws them, top to bottom, and include the
 * nodes the default view leaves out: jumping to one draws the whole graph for as long as it is the
 * target.
 *
 * The page opens the search on the `graph.search` command (Ctrl+F, ⌘F on macOS, rebindable),
 * instead of the browser's find; the command declines while the search box already has focus, so
 * pressing it again there lets the browser's own find through.
 */
import type { ProposalGraphNode, ProposalGraphRow } from "@prismshadow/penguin-server/api";
import type { CommandHandler } from "../../lib/shortcuts/dispatcher";
import { segments } from "./pr-graph-segments";

type Searched = Pick<ProposalGraphNode, "key" | "number" | "branch" | "title" | "proposal">;

/** Whether a node matches the query; an empty query matches nothing. */
export function nodeMatches(node: Searched, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return false;
  const pr = /^#(\d+)$/.exec(q);
  if (pr !== null) return node.number === Number(pr[1]);
  const proposal = /^(?:proposal\s*|p)(\d+)$/.exec(q);
  if (proposal !== null) return node.proposal?.number === Number(proposal[1]);
  if (/^\d+$/.test(q)) {
    const n = Number(q);
    if (node.number === n || node.proposal?.number === n) return true;
  }
  return [node.branch, node.title, node.proposal?.title ?? ""].some((text) =>
    text.toLowerCase().includes(q),
  );
}

/** The keys of the matching nodes the graph draws, in the full drawing's order. */
export function searchHits(
  rows: readonly ProposalGraphRow[],
  nodes: readonly Searched[],
  query: string,
): string[] {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  return rows
    .filter((r) => r.kind === "node")
    .map((r) => r.key)
    .filter((key) => {
      const node = byKey.get(key);
      return node !== undefined && nodeMatches(node, query);
    });
}

/** The next hit after `index` (Enter), or the previous one (Shift+Enter), going round; -1 for none. */
export function stepHit(index: number, count: number, back: boolean): number {
  if (count === 0) return -1;
  if (index < 0) return back ? count - 1 : 0;
  return (index + (back ? count - 1 : 1)) % count;
}

/** The head key of the segment whose run holds `key` (the key a fold is stored under), or null. */
export function segmentHolding(
  rows: readonly ProposalGraphRow[],
  nodes: ReadonlyArray<Pick<ProposalGraphNode, "key" | "parent">>,
  key: string,
): string | null {
  const at = rows.findIndex((r) => r.kind === "node" && r.key === key);
  if (at < 0) return null;
  for (const run of segments(rows, nodes).values()) {
    if (run.includes(at)) return rows[run[run.length - 1]!]!.key;
  }
  return null;
}

/**
 * The `graph.search` command's handler: opens the search and takes the key, unless the search box
 * already has focus — then it declines, and the key goes on to the browser's own find.
 */
export function graphSearchCommand(deps: {
  focused: () => boolean;
  open: () => void;
}): CommandHandler {
  return () => {
    if (deps.focused()) return false;
    deps.open();
    return true;
  };
}

/** The localStorage key the "Show other PRs" toggle is remembered under, per browser. */
export const SHOW_OTHERS_KEY = "penguin.prGraph.showOthers";

/** The remembered toggle; false when storage is unavailable or holds anything else. */
export function readShowOthers(storage: Pick<Storage, "getItem"> | null): boolean {
  try {
    return storage?.getItem(SHOW_OTHERS_KEY) === "1";
  } catch {
    return false;
  }
}

/** Remembers the toggle; a storage that refuses (private mode, quota) is ignored. */
export function writeShowOthers(storage: Pick<Storage, "setItem"> | null, on: boolean): void {
  try {
    storage?.setItem(SHOW_OTHERS_KEY, on ? "1" : "0");
  } catch {
    // Remembering is a convenience: the toggle still works for this page.
  }
}

/**
 * Which rows to draw: the organization's own part by default, every node with the toggle on —
 * or while the search's target is a node the own part leaves out.
 */
export function drawnRows(
  graph: { rows: ProposalGraphRow[]; ownRows: ProposalGraphRow[] },
  showOthers: boolean,
  target: string | null,
): ProposalGraphRow[] {
  if (showOthers) return graph.rows;
  const own = graph.ownRows;
  const hidden = target !== null && !own.some((r) => r.kind === "node" && r.key === target);
  return hidden ? graph.rows : own;
}
