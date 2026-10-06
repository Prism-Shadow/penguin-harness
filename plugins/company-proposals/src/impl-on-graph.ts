/**
 * The default rules that keep an impl registration drawable on the PR graph (pr-chain.ts). A node
 * that is not a PR is placed by the base its impl registered, so a base that names nothing on the
 * graph leaves the node `no-base` and every layer above it `above`; and a merged PR attached to a
 * proposal whose impl head is still other proposals' base takes that branch off the graph (the
 * PR claims the proposal, the merged PR is no node) and the layers stacked on it with it.
 *
 * - `base_not_on_graph` (400): a base the request declares must be the graph's base branch, the
 *   impl head of another proposal that is not merged or rejected, or the head of an open PR on
 *   the delivery repository as the last graph laid out has it. A base GitHub reports for a PR is
 *   the PR's fact, not judged; a base already registered is not judged again.
 * - `base_in_use` (409): a registered PR that is merged must not have as its head branch the
 *   registered base of another proposal that is not merged or rejected.
 *
 * The rules are pure: what they need from outside the store — the cached graph, the cached PR
 * status — the service reads before the write (ImplGraphFacts) and hands in as `params.facts`;
 * the other proposals' impls are looked up inside the write (`tx`), so no writer slips between.
 */
import type {
  ProposalBranchRef,
  ProposalGraphResponse,
  ProposalPrStatus,
} from "@prismshadow/penguin-server/api";
import { ProposalError, type Proposal, type ProposalImplSide } from "./domain.js";
import type { GraphStore, ProposalTx } from "./ports.js";

/** The impl a write is about to register, as the service hands it to the guard inside the write. */
export interface PlannedImpl {
  head: ProposalBranchRef | null;
  /** The base side with the repository it resolved to; absent from an adoption (a PR alone). */
  base?: ProposalImplSide | null;
  pr: { key: string; label: string } | null;
}

/** What the service read for these rules before the write, from caches only (no I/O in a guard). */
export interface ImplGraphFacts {
  /** The branch the graph stacks on: the cached graph's, else the settings' or the stored default branch. */
  baseBranch: string;
  /** The repositories the graph reads — the delivery repository and its origins — lower-cased; empty when unknown. */
  repos: string[];
  /** The head branches of the open PRs on the delivery repository in the last graph laid out; null when none is cached. */
  openHeads: string[] | null;
  /** The request names the base: only such a base is judged. */
  declaredBase: boolean;
  /** The registered PR as the caches know it: its status (null: unknown) and head branch (null: unknown). */
  pr: { status: ProposalPrStatus | null; branch: string | null } | null;
}

/** The note on a registration whose base was judged with no graph laid out yet. */
export const OPEN_PRS_UNCHECKED =
  "The PR graph has not been read yet, so the base was not checked against the open PRs; it was judged by the base branch and the other proposals' impl heads only.";

const live = (o: { status: string }): boolean => o.status !== "merged" && o.status !== "rejected";

function inRepos(facts: ImplGraphFacts, repo: string): boolean {
  return facts.repos.length === 0 || facts.repos.includes(repo.toLowerCase());
}

/** `base_not_on_graph`: a newly declared base names something the graph draws. */
export function requireBaseOnGraph(
  p: Proposal,
  planned: PlannedImpl,
  facts: ImplGraphFacts,
  tx: ProposalTx,
): void {
  const base = planned.base ?? null;
  if (base === null || planned.head === null || !facts.declaredBase) return;
  const current = p.impl?.base ?? null;
  if (
    current !== null &&
    current.branch === base.branch &&
    current.repo.toLowerCase() === base.repo.toLowerCase()
  ) {
    return;
  }
  if (inRepos(facts, base.repo)) {
    if (base.branch === facts.baseBranch) return;
    const heads = tx.implsOnBranch("head", base.branch);
    if (heads.some((o) => o.number !== p.number && live(o) && inRepos(facts, o.repo))) return;
    if (facts.openHeads?.includes(base.branch) === true) return;
  }
  throw new ProposalError(
    400,
    "base_not_on_graph",
    `The base branch ${base.remote}/${base.branch} is not on the PR graph: it is not ${facts.baseBranch}, no open proposal's impl head${facts.openHeads === null ? "" : " and no open PR's head"}. Register a proposal whose impl head is ${base.branch}, or open a PR for it, first.`,
  );
}

/** `base_in_use`: a merged PR does not take a branch other proposals still stack on off the graph. */
export function requireMergedPrNotABase(
  p: Proposal,
  planned: PlannedImpl,
  facts: ImplGraphFacts,
  tx: ProposalTx,
): void {
  const pr = facts.pr;
  if (planned.pr === null || pr === null || pr.status !== "merged" || pr.branch === null) return;
  const branch = pr.branch;
  const above = tx
    .implsOnBranch("base", branch)
    .filter((o) => o.number !== p.number && live(o) && inRepos(facts, o.repo))
    .map((o) => `#${o.number}`);
  if (above.length === 0) return;
  throw new ProposalError(
    409,
    "base_in_use",
    `${planned.pr.label} is merged, and its head ${branch} is still the impl base of ${above.join(", ")}: attached here, it takes ${branch} off the PR graph and them with it. Register the branch that is still on the chain instead (keep ${branch} as the impl head without this PR), or move ${above.join(", ")} onto another base first.`,
  );
}

/**
 * The facts for a registration, from what is cached: the last graph laid out (GraphRefresher
 * `cached`), the PR statuses the views keep, and the merged or closed PRs a refresh read. A PR's
 * head branch is the impl head when one is declared (its PR was checked against it).
 */
export function implGraphFacts(input: {
  cached: { graph: ProposalGraphResponse | null; base: string; repos: string[] };
  store: Pick<GraphStore, "prStatuses" | "pull">;
  planned: PlannedImpl;
  declaredBase: boolean;
}): ImplGraphFacts {
  const { graph } = input.cached;
  const repos =
    graph === null ? input.cached.repos : [graph.repo, ...graph.origins.map((o) => o.repo)];
  let pr: ImplGraphFacts["pr"] = null;
  const key = input.planned.pr?.key;
  if (key !== undefined) {
    const at = key.lastIndexOf("#");
    const read = input.store.pull(key.slice(0, at), Number(key.slice(at + 1)));
    pr = {
      status: input.store.prStatuses([key]).get(key)?.status ?? read?.state ?? null,
      branch: input.planned.head?.branch ?? read?.branch ?? null,
    };
  }
  return {
    baseBranch: graph?.base.branch ?? input.cached.base,
    repos: repos.filter((r) => r !== "").map((r) => r.toLowerCase()),
    openHeads:
      graph === null ? null : graph.nodes.flatMap((n) => (n.number === null ? [] : [n.branch])),
    declaredBase: input.declaredBase,
    pr,
  };
}
