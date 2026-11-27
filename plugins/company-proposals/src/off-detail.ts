/**
 * What an off-chain node's row says about fixing it (ProposalGraphOff `missing` and `by`), for a
 * node whose own declared base names no node of the graph:
 *
 * - The base branch was claimed away: a proposal whose impl head is that branch registered a PR
 *   that is merged, so the branch is no node and the proposal is listed apart as `merged`. The
 *   detail names that proposal and its PR — registering the branch still on the chain fixes it.
 * - Otherwise, for `no-base`: the base names nothing at all. The detail names the base and the
 *   node's proposal, which registered it — registering a proposal or opening a PR for that base
 *   fixes it.
 *
 * A node stacked on an off-chain node (`above`) or passed over at a fork has a drawn base: its
 * `at` already names where to look. Pure: the layout only reads what buildGraph laid out.
 */
import type {
  ProposalGraphNode,
  ProposalGraphOff,
  ProposalGraphUnplaced,
} from "@prismshadow/penguin-server/api";
import type { GraphProposal } from "./pr-chain.js";

/** The reasons that come from a node's own base or edge, where a missing base can be the cause. */
const OWN: ReadonlySet<ProposalGraphOff["reason"]> = new Set(["no-base", "old-line", "unread"]);

/** Adds the fixing detail to each off-chain node it applies to, in place. */
export function addOffDetails(
  nodes: readonly ProposalGraphNode[],
  baseBranch: string,
  proposals: readonly GraphProposal[],
  unplaced: readonly ProposalGraphUnplaced[],
): void {
  const drawn = new Set(nodes.map((n) => n.branch));
  const merged = new Set(unplaced.filter((u) => u.reason === "merged").map((u) => u.number));
  for (const n of nodes) {
    const off = n.off;
    if (off === null || !OWN.has(off.reason)) continue;
    if (n.base === baseBranch || drawn.has(n.base)) continue;
    const claimer = proposals.find(
      (p) => p.implPr !== null && p.implBranch?.branch === n.base && merged.has(p.number),
    );
    if (claimer !== undefined) {
      n.off = { ...off, missing: n.base, by: { proposal: claimer.number, pr: claimer.implPr! } };
    } else if (off.reason === "no-base") {
      n.off = {
        ...off,
        missing: n.base,
        ...(n.proposal === null ? {} : { by: { proposal: n.proposal.number } }),
      };
    }
  }
}
