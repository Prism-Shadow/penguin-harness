/**
 * The PR graph's facts and their layout. The facts are the delivery repository's base tip and
 * open change requests, the tips of the impl branches no PR is open on, the merged or closed
 * ones a declared base walks through, the impl PRs that are not open there, each origin's open
 * ones, and the comparisons between commits. A refresh (graph-reader.ts) reads them; a read
 * lays them out from the stored copy (storedFacts) with the same pure functions.
 *
 * `inputKey` hashes everything the layout reads except the comparisons, which never change for
 * a pair of commits, together with the identity of the code that lays it out (layout-code.ts):
 * a snapshot is keyed by it, so a build with other layout rules does not answer an older
 * build's snapshot.
 */
import { createHash } from "node:crypto";
import type { ProposalGraphResponse } from "@prismshadow/penguin-server/api";
import {
  buildGraph,
  parentsOf,
  pullKey,
  type Comparison,
  type GraphProposal,
  type ImplPull,
  type OpenPull,
  type ShutPull,
} from "./pr-chain.js";
import { headsOf, implBranchesOn } from "./graph-heads.js";
import type { GraphStore } from "./ports.js";

/** Rounds of looking up the merged or closed PRs a walk from a declared base passes through. */
export const MAX_WALK_ROUNDS = 20;

/** Where the graph reads from: the delivery repository, its base branch, the origins. */
export interface GraphProject {
  repo: string;
  base: string;
  origins: Array<{ name: string; repo: string }>;
}

/** A source of facts: the stored copy, or what a refresh has just read. */
export interface GraphFacts {
  baseHead: string | null;
  /** A branch's tip on the delivery repository; null when it has none (or it was not read). */
  tip(branch: string): string | null;
  openPulls(repo: string): OpenPull[] | null;
  shutOn(branch: string): ShutPull | null;
  pull(repo: string, number: number): ImplPull | null;
  compare(from: string, to: string): Comparison | undefined;
}

/** The stored facts of a repository (GraphStore). */
export function storedFacts(store: GraphStore, project: GraphProject): GraphFacts {
  const refs = store.refs(project.repo);
  return {
    baseHead: refs.get(`refs/heads/${project.base}`) ?? null,
    tip: (branch) => refs.get(`refs/heads/${branch}`) ?? null,
    openPulls: (repo) => store.openPulls(repo),
    shutOn: (branch) => store.shutOn(project.repo, branch),
    pull: (repo, number) => store.pull(repo, number),
    compare: (from, to) => store.comparisons(project.repo, [[from, to]]).get(`${from}...${to}`),
  };
}

/** The inputs of one layout, read from a fact source; the comparisons are asked during it. */
export interface GraphInputs {
  project: GraphProject;
  baseHead: string | null;
  pulls: OpenPull[];
  /** The tips of the live impl branches with no PR, by branch (those the repository has). */
  tips: Map<string, string>;
  shut: Map<string, ShutPull | null>;
  implPulls: Map<string, ImplPull | null>;
  origins: Array<{ name: string; repo: string; pulls: OpenPull[] | null }>;
  proposals: GraphProposal[];
  inputKey: string;
}

/** The impl PRs of live proposals that are not open on the delivery repository. */
export function offGraphImplPrs(
  project: GraphProject,
  pulls: readonly OpenPull[],
  proposals: readonly GraphProposal[],
): Array<{ key: string; repo: string; number: number }> {
  const open = new Set(pulls.map((p) => `${project.repo.toLowerCase()}#${p.number}`));
  const out = new Map<string, { key: string; repo: string; number: number }>();
  for (const p of proposals) {
    if (p.status === "rejected" || p.implPr === null) continue;
    const key = pullKey(p.implPr);
    if (key === null || open.has(key)) continue;
    const [repo, n] = key.split("#") as [string, string];
    out.set(key, { key, repo, number: Number(n) });
  }
  return [...out.values()];
}

/** The tips of the live impl branches with no PR, as a fact source has them. */
export function tipsOf(
  facts: Pick<GraphFacts, "tip">,
  repo: string,
  proposals: readonly GraphProposal[],
): Map<string, string> {
  const tips = new Map<string, string>();
  for (const branch of implBranchesOn(repo, proposals)) {
    const tip = facts.tip(branch);
    if (tip !== null) tips.set(branch, tip);
  }
  return tips;
}

/** The branches the declared bases walk to that no node has, looked up round by round. */
export function walkShut(
  heads: ReadonlyArray<{ key: string; branch: string; base: string }>,
  base: string,
  lookup: (branch: string) => ShutPull | null,
): Map<string, ShutPull | null> {
  const shut = new Map<string, ShutPull | null>();
  for (let round = 0; round < MAX_WALK_ROUNDS; round++) {
    const missing = new Set<string>();
    for (const p of parentsOf(heads, shut, base).values()) {
      if (p.missing !== null) missing.add(p.missing);
    }
    if (missing.size === 0) break;
    for (const branch of missing) shut.set(branch, lookup(branch));
  }
  return shut;
}

/** Everything a layout reads except the comparisons, with its key; `code` is the layout code's identity. */
export function inputsOf(
  facts: GraphFacts,
  project: GraphProject,
  proposals: GraphProposal[],
  code: string,
): GraphInputs {
  const pulls = facts.openPulls(project.repo) ?? [];
  const tips = tipsOf(facts, project.repo, proposals);
  const { heads } = headsOf({
    repo: project.repo,
    baseBranch: project.base,
    pulls,
    proposals,
    tips,
  });
  const shut = walkShut(heads, project.base, (b) => facts.shutOn(b));
  const implPulls = new Map<string, ImplPull | null>();
  for (const pr of offGraphImplPrs(project, pulls, proposals)) {
    implPulls.set(pr.key, facts.pull(pr.repo, pr.number));
  }
  const origins = project.origins.map((o) => ({
    ...o,
    pulls: o.repo.toLowerCase() === project.repo.toLowerCase() ? null : facts.openPulls(o.repo),
  }));
  const keyed = {
    code,
    repo: project.repo,
    base: project.base,
    baseHead: facts.baseHead,
    pulls: [...pulls].sort((a, b) => a.number - b.number),
    tips: [...tips].sort(([a], [b]) => a.localeCompare(b)),
    shut: [...shut].sort(([a], [b]) => a.localeCompare(b)),
    implPulls: [...implPulls].sort(([a], [b]) => a.localeCompare(b)),
    origins,
    proposals: [...proposals].sort((a, b) => a.number - b.number),
  };
  const inputKey = createHash("sha256").update(JSON.stringify(keyed)).digest("hex");
  return {
    project,
    baseHead: facts.baseHead,
    pulls,
    tips,
    shut,
    implPulls,
    origins,
    proposals,
    inputKey,
  };
}

/** A layout with the comparisons it used and the ones it found missing. */
export interface Layout {
  graph: ProposalGraphResponse;
  used: Array<[string, string]>;
  missing: Array<[string, string]>;
}

/**
 * Lays the inputs out (buildGraph), the deployments left out — they are placed on every read
 * from the stored comparisons, never part of a snapshot.
 */
export function layout(
  inputs: GraphInputs,
  compare: (from: string, to: string) => Comparison | undefined,
  checkedAt: string,
): Layout {
  const used: Array<[string, string]> = [];
  const missing: Array<[string, string]> = [];
  const seen = new Set<string>();
  const graph = buildGraph({
    repo: inputs.project.repo,
    base: { branch: inputs.project.base, head: inputs.baseHead },
    pulls: inputs.pulls,
    origins: inputs.origins,
    shut: inputs.shut,
    tips: inputs.tips,
    compare: (from, to) => {
      const found = compare(from, to);
      const key = `${from}...${to}`;
      if (!seen.has(key)) {
        seen.add(key);
        (found === undefined ? missing : used).push([from, to]);
      }
      return found;
    },
    proposals: inputs.proposals,
    implPulls: inputs.implPulls,
    deployments: [],
    errors: [],
    checkedAt,
  });
  return { graph, used, missing };
}

/** Whether a snapshot's layout lacked a comparison: a refresh can complete it. */
export function incomplete(graph: ProposalGraphResponse): boolean {
  return (
    graph.nodes.some((n) => n.off?.reason === "unread") ||
    graph.unplaced.some((u) => u.reason === "unread" && u.implPr !== null)
  );
}
