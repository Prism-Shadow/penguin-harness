/**
 * What the PR graph page derives from `GET …/proposals/graph`. The server lays the graph out
 * itself (`rows`, in Sapling's smartlog shape); pr-graph-segments.ts groups those rows, and this
 * module holds the small questions the page asks of the nodes.
 */
import type { ProposalGraphNode } from "@prismshadow/penguin-server/api";

/** The key that names the base branch wherever a node's key is expected. */
const BASE = "";

/**
 * How many stacks start on the base branch: its children that are on the chain. Every line hanging
 * straight from the base is a stack of its own, so more than one is several stacks side by side.
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

/** The node showing a proposal's impl (its PR or its branch), or null when it has none on the graph. */
export function nodeOfProposal(
  nodes: readonly ProposalGraphNode[],
  proposal: number,
): ProposalGraphNode | null {
  return nodes.find((n) => n.proposal?.number === proposal) ?? null;
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
 * Whether a merged proposal stays out of the graph's lists by default. A merged proposal whose
 * impl PR is still a layer on the chain stays drawn (the layer is real work on the stack); one
 * that is off the chain, undrawable, or has no open impl PR is finished business, and listing it
 * beside the live problems only reads as one. The page folds these into a "merged" line.
 */
export function foldedAsMerged(status: string | null | undefined): boolean {
  return status === "merged";
}
