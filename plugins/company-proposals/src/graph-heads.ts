/**
 * The heads the PR graph draws: every open PR on the delivery repository, and every registered
 * impl branch no open PR claims yet. A proposal opens its impl branch as soon as it is created
 * and a PR only once it is approved, so a graph of open PRs alone would leave a proposal off it
 * from creation to approval.
 *
 * A node's key is its head branch: when a PR is opened on an impl branch, the node of that
 * branch carries the PR — never a second node. A second open PR on a branch name another node
 * already has (a PR from another repository) is keyed `<branch>#<number>`. `""` names the base
 * branch and is never a node's key.
 *
 * An impl branch is a node when its proposal is live (not rejected, not merged), its head
 * resolved to the delivery repository, and that repository has the branch (its tip, from the
 * probe's `ls-remote`). Its declared base is the base side it registered. Any other branch-only
 * impl is listed apart: `unread` when its head is not on the delivery repository or could not be
 * read there, `merged` (into the base it registered) when the proposal is merged. Pure: no git,
 * no network.
 */
import type { ProposalGraphUnplaced } from "@prismshadow/penguin-server/api";
import { refLabel } from "./impl-branch.js";
import type { ProposalFacts } from "./ports.js";
import type { GraphProposal, OpenPull } from "./pr-chain.js";
import { parsePullUrl } from "./pr-status.js";

/** The key that names the base branch wherever a node's key is expected. */
export const BASE_KEY = "";

/** One head the graph lays out: an open PR, or a branch-only impl (`pull` null). */
export interface GraphHead {
  key: string;
  branch: string;
  head: string;
  /** The declared base branch: the PR's, or the base the impl registered. */
  base: string;
  pull: OpenPull | null;
  /** The proposal whose impl this is; null for a PR no proposal registered. */
  proposal: GraphProposal | null;
}

/** The impl branches with no PR on a repository: by head branch, the first proposal to name one. */
function branchOnly(repo: string, proposals: readonly GraphProposal[]): Map<string, GraphProposal> {
  const repoKey = repo.toLowerCase();
  const out = new Map<string, GraphProposal>();
  for (const p of [...proposals].sort((a, b) => a.number - b.number)) {
    const head = p.implBranch;
    if (p.status === "rejected" || p.implPr !== null || head == null) continue;
    if (head.repo?.toLowerCase() !== repoKey || out.has(head.branch)) continue;
    out.set(head.branch, p);
  }
  return out;
}

/**
 * The branches whose tip the graph reads: every branch-only impl on the delivery repository
 * that is live. The tips are in the input key, so a tip that moves lays the graph out again.
 */
export function implBranchesOn(repo: string, proposals: readonly GraphProposal[]): string[] {
  return [...branchOnly(repo, proposals)]
    .filter(([, p]) => p.status !== "merged")
    .map(([branch]) => branch)
    .sort();
}

/**
 * Every head the graph lays out, in drawing order (PRs by number, then branch nodes by key),
 * and the branch-only impls that are not drawn, with why. `tips` holds each branch's tip on the
 * delivery repository, as `ls-remote` read it; a branch missing from it was not read.
 */
export function headsOf(input: {
  repo: string;
  baseBranch: string;
  pulls: readonly OpenPull[];
  proposals: readonly GraphProposal[];
  tips: ReadonlyMap<string, string>;
}): { heads: GraphHead[]; unplaced: ProposalGraphUnplaced[] } {
  const repoKey = input.repo.toLowerCase();
  const byPr = new Map<string, GraphProposal>();
  for (const p of input.proposals) {
    if (p.status === "rejected" || p.implPr === null) continue;
    const key = pullKey(p.implPr);
    if (key !== null) byPr.set(key, p);
  }
  const onlyBranch = branchOnly(input.repo, input.proposals);
  const heads: GraphHead[] = [];
  const keys = new Set<string>([BASE_KEY]);
  for (const pull of [...input.pulls].sort((a, b) => a.number - b.number)) {
    const key = keys.has(pull.branch) ? `${pull.branch}#${pull.number}` : pull.branch;
    keys.add(key);
    heads.push({
      key,
      branch: pull.branch,
      head: pull.head,
      base: pull.base,
      pull,
      proposal: byPr.get(`${repoKey}#${pull.number}`) ?? onlyBranch.get(pull.branch) ?? null,
    });
  }
  const claimed = new Set(heads.flatMap((h) => (h.proposal === null ? [] : [h.proposal.number])));
  const unplaced: ProposalGraphUnplaced[] = [];
  const listed = (p: GraphProposal, reason: "unread" | "merged"): ProposalGraphUnplaced => ({
    number: p.number,
    title: p.title,
    status: p.status,
    implPr: null,
    branch: p.implBranch?.label ?? null,
    reason,
    at: null,
    // A merged proposal's impl went into the base it registered.
    into: reason === "merged" ? (p.implBranch?.base ?? input.baseBranch) : null,
  });
  const branchNodes: GraphHead[] = [];
  for (const p of input.proposals) {
    const impl = p.implBranch;
    if (p.status === "rejected" || p.implPr !== null || impl == null || claimed.has(p.number)) {
      continue;
    }
    if (p.status === "merged") {
      unplaced.push(listed(p, "merged"));
      continue;
    }
    const tip = input.tips.get(impl.branch);
    if (
      impl.repo?.toLowerCase() !== repoKey ||
      onlyBranch.get(impl.branch) !== p ||
      tip === undefined ||
      keys.has(impl.branch)
    ) {
      unplaced.push(listed(p, "unread"));
      continue;
    }
    keys.add(impl.branch);
    branchNodes.push({
      key: impl.branch,
      branch: impl.branch,
      head: tip,
      base: impl.base ?? input.baseBranch,
      pull: null,
      proposal: p,
    });
  }
  branchNodes.sort((a, b) => a.key.localeCompare(b.key));
  return { heads: [...heads, ...branchNodes], unplaced };
}

/** `owner/repo#n`, lower-cased owner and repo: how two URLs of one PR are recognised as one. */
export function pullKey(url: string): string | null {
  const ref = parsePullUrl(url);
  return ref === null ? null : `${ref.owner.toLowerCase()}/${ref.repo.toLowerCase()}#${ref.number}`;
}

/** Each live proposal's declared impl head, with the repository stored when it was registered. */
export function declaredHeads(
  proposals: readonly ProposalFacts[],
): Map<number, { label: string; repo: string; branch: string; base: string | null }> {
  const out = new Map<
    number,
    { label: string; repo: string; branch: string; base: string | null }
  >();
  for (const p of proposals) {
    const head = p.impl?.head;
    if (p.status === "rejected" || head == null) continue;
    out.set(p.number, {
      label: refLabel(head),
      repo: head.repo,
      branch: head.branch,
      base: p.impl?.base?.branch ?? null,
    });
  }
  return out;
}
