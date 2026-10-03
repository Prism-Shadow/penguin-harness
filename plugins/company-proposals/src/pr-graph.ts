/**
 * The PR graph's facts and their layout. The facts are the delivery repository's base tip and
 * open change requests, the merged or closed ones a declared base walks through, the impl PRs
 * that are not open there, each origin's open ones, and the comparisons between commits. A
 * refresh (collect) reads them: change request metadata from the Forge, refs into the GitMirror,
 * and every comparison the layout asks for computed in that mirror — git ancestry, no GitHub
 * compare. A read lays them out from the stored copy (storedFacts) with the same pure
 * functions; buildGraph (pr-chain.ts) is unchanged.
 *
 * `inputKey` hashes everything the layout reads except the comparisons, which never change for
 * a pair of commits: a snapshot is keyed by it.
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
import type { ChangeRequest, Forge, GitMirror, GraphStore } from "./ports.js";

/** Rounds of looking up the merged or closed PRs a walk from a declared base passes through. */
const MAX_WALK_ROUNDS = 20;
/** Comparisons computed at once in the mirror. */
const CONCURRENCY = 8;
const SHA = /^[0-9a-f]{40}$/i;

/** Where the graph reads from: the delivery repository, its base branch, the origins. */
export interface GraphProject {
  repo: string;
  base: string;
  origins: Array<{ name: string; repo: string }>;
}

/** A source of facts: the stored copy, or what a refresh has just read. */
export interface GraphFacts {
  baseHead: string | null;
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

/** The branches the declared bases walk to that no open PR has, looked up round by round. */
function walkShut(
  pulls: readonly OpenPull[],
  base: string,
  lookup: (branch: string) => ShutPull | null,
): Map<string, ShutPull | null> {
  const shut = new Map<string, ShutPull | null>();
  for (let round = 0; round < MAX_WALK_ROUNDS; round++) {
    const missing = new Set<string>();
    for (const p of parentsOf(pulls, shut, base).values()) {
      if (p.missing !== null) missing.add(p.missing);
    }
    if (missing.size === 0) break;
    for (const branch of missing) shut.set(branch, lookup(branch));
  }
  return shut;
}

/** Everything a layout reads except the comparisons, with its key. */
export function inputsOf(
  facts: GraphFacts,
  project: GraphProject,
  proposals: GraphProposal[],
): GraphInputs {
  const pulls = facts.openPulls(project.repo) ?? [];
  const shut = walkShut(pulls, project.base, (b) => facts.shutOn(b));
  const implPulls = new Map<string, ImplPull | null>();
  for (const pr of offGraphImplPrs(project, pulls, proposals)) {
    implPulls.set(pr.key, facts.pull(pr.repo, pr.number));
  }
  const origins = project.origins.map((o) => ({
    ...o,
    pulls:
      o.repo.toLowerCase() === project.repo.toLowerCase() ? null : facts.openPulls(o.repo),
  }));
  const keyed = {
    repo: project.repo,
    base: project.base,
    baseHead: facts.baseHead,
    pulls: [...pulls].sort((a, b) => a.number - b.number),
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

/** Compares two commits in the mirror the way GitHub's `compare/<from>...<to>` answers. */
export async function compareInMirror(
  mirror: GitMirror,
  from: string,
  to: string,
): Promise<Comparison> {
  const { ahead, behind } = await mirror.counts(from, to);
  const mergeBase = await mirror.mergeBase(from, to);
  const relation =
    ahead === 0 && behind === 0
      ? "same"
      : behind === 0
        ? "ahead"
        : ahead === 0
          ? "behind"
          : "diverged";
  // GitHub's "empty": the base's tree is the merge base's — the commits `to` lacks carry nothing.
  const empty = mergeBase !== null && (await mirror.treeEquals(from, mergeBase));
  return { relation, ahead, behind, mergeBase, empty };
}

/** Runs `task` over `items`, at most `limit` at a time. */
export async function eachAtMost<T>(
  limit: number,
  items: readonly T[],
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) await task(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** What one refresh read and computed. */
export interface Collected {
  pulls: ChangeRequest[];
  openOf: string[];
  comparisons: Array<{ from: string; to: string; cmp: Comparison }>;
  layout: Layout;
  inputs: GraphInputs;
  errors: string[];
}

/** The pairs a deployment's commit is compared on: every layer's head against it. */
export function deploymentPairs(
  graph: ProposalGraphResponse,
  commits: readonly string[],
): Array<[string, string]> {
  const heads = [graph.base.head, ...graph.nodes.map((n) => n.head)].filter(
    (h): h is string => h !== null,
  );
  const out: Array<[string, string]> = [];
  for (const commit of commits) {
    for (const head of heads) {
      if (!head.toLowerCase().startsWith(commit.toLowerCase())) out.push([head, commit]);
    }
  }
  return out;
}

/**
 * The refresh's reads: the Forge for change requests, the mirror for refs and comparisons. A
 * failed forge read or fetch fails the refresh (the stored facts stand); a comparison that
 * cannot be made (a commit the mirror cannot have) stays missing and the graph reads it
 * `unread`, as before.
 */
export class PrGraphReader {
  constructor(
    private readonly deps: {
      forge: Forge;
      mirror: GitMirror;
      store: GraphStore;
      log?: (line: string) => void;
    },
  ) {}

  async collect(opts: {
    project: GraphProject;
    proposals: GraphProposal[];
    /** The refs `ls-remote` read just now. */
    refs: Map<string, string>;
    /** The deployments' commits, compared against every layer. */
    deploymentCommits: string[];
    checkedAt: string;
    signal?: AbortSignal;
  }): Promise<Collected> {
    const { forge, mirror, store } = this.deps;
    const { project, signal } = opts;
    const errors: string[] = [];
    const repo = project.repo;

    // Change request metadata: the open list, the walk through merged or closed ones, the impl
    // PRs off the open list, each origin's open list.
    const open = await forge.listChangeRequests({ repo, open: true }, signal);
    const openPulls = open.map(openPullOf);
    const shutRead = new Map<string, ShutPull | null>();
    for (let round = 0; round < MAX_WALK_ROUNDS; round++) {
      const missing = new Set<string>();
      for (const p of parentsOf(openPulls, shutRead, project.base).values()) {
        if (p.missing !== null) missing.add(p.missing);
      }
      if (missing.size === 0) break;
      const found = await forge.listChangeRequests({ repo, shutOn: [...missing] }, signal);
      for (const branch of missing) shutRead.set(branch, latestShut(found, branch));
      open.push(...found.filter((cr) => missing.has(cr.branch)));
    }
    const implByRepo = new Map<string, number[]>();
    for (const pr of offGraphImplPrs(project, openPulls, opts.proposals)) {
      implByRepo.set(pr.repo, [...(implByRepo.get(pr.repo) ?? []), pr.number]);
    }
    const impl: ChangeRequest[] = [];
    for (const [r, numbers] of implByRepo) {
      try {
        impl.push(...(await forge.listChangeRequests({ repo: r, numbers }, signal)));
      } catch (err) {
        errors.push(`${numbers.length} impl PRs on ${r} not read: ${reason(err)}`);
      }
    }
    const originPulls = new Map<string, ChangeRequest[]>();
    for (const o of project.origins) {
      if (o.repo.toLowerCase() === repo.toLowerCase() || originPulls.has(o.repo)) continue;
      try {
        originPulls.set(o.repo, await forge.listChangeRequests({ repo: o.repo, open: true }, signal));
      } catch (err) {
        errors.push(`${o.repo}: open PRs not read: ${reason(err)}`);
      }
    }

    // The refs the graph uses, fetched when the mirror lacks their commit: the base branch, each
    // open PR's head, each impl PR's head on this repository.
    const wanted = new Map<string, string>();
    const baseRef = `refs/heads/${project.base}`;
    const baseHead = opts.refs.get(baseRef) ?? null;
    if (baseHead !== null) wanted.set(baseRef, baseHead);
    for (const cr of [...open.filter((c) => c.state === "open"), ...impl]) {
      if (cr.repo.toLowerCase() !== repo.toLowerCase()) continue;
      const ref = `refs/pull/${cr.number}/head`;
      wanted.set(ref, opts.refs.get(ref) ?? cr.head);
    }
    // Only what moved since the last refresh can be missing; the mirror is asked to be sure.
    const lacking = new Set(await mirror.missing([...wanted.values()]));
    await mirror.fetch(
      [...wanted].filter(([, oid]) => lacking.has(oid.toLowerCase())).map(([ref]) => ref),
      signal !== undefined ? { signal } : {},
    );
    // An origin's PR on a node's branch: its head comes from that repository.
    const branches = new Set(openPulls.map((p) => p.branch));
    for (const [r, list] of originPulls) {
      const twins = list.filter((cr) => branches.has(cr.branch));
      const absent = new Set(await mirror.missing(twins.map((t) => t.head)));
      const refs = twins.filter((t) => absent.has(t.head)).map((t) => `refs/pull/${t.number}/head`);
      await mirror
        .fetch(refs, { from: r, ...(signal !== undefined ? { signal } : {}) })
        .catch((err: unknown) => errors.push(`${r}: heads not fetched: ${reason(err)}`));
    }
    const deploymentCommits = opts.deploymentCommits.filter((c) => SHA.test(c));
    const absentCommits = await mirror.missing(deploymentCommits);
    if (absentCommits.length > 0) {
      await mirror
        .fetch(absentCommits, signal !== undefined ? { signal } : {})
        .catch((err: unknown) => this.deps.log?.(`[company-proposals] deployment commits not fetched: ${reason(err)}`));
    }

    // The facts as read, laid out; every comparison it asks for computed in the mirror, then
    // laid out again until nothing new is asked.
    const pullsRead = [...open, ...impl, ...[...originPulls.values()].flat()];
    const facts: GraphFacts = {
      baseHead,
      openPulls: (r) =>
        r.toLowerCase() === repo.toLowerCase()
          ? openPulls
          : (originPulls.get(r)?.filter((cr) => cr.state === "open").map(openPullOf) ??
            // Not read this time: the stored list, as a read would lay it out.
            store.openPulls(r)),
      shutOn: (branch) => shutRead.get(branch) ?? null,
      pull: (r, n) => {
        const cr = impl.find((x) => x.repo.toLowerCase() === r.toLowerCase() && x.number === n);
        return cr === undefined
          ? null
          : { state: cr.state, branch: cr.branch, head: cr.head, base: cr.base };
      },
      compare: () => undefined,
    };
    const inputs = inputsOf(facts, project, opts.proposals);
    const known = new Map<string, Comparison>();
    const failed = new Map<string, string>();
    const computed: Array<{ from: string; to: string; cmp: Comparison }> = [];
    const compare = (from: string, to: string): Comparison | undefined => {
      const key = `${from}...${to}`;
      if (!known.has(key) && !failed.has(key)) {
        const stored = store.comparisons(repo, [[from, to]]).get(key);
        if (stored !== undefined) known.set(key, stored);
      }
      return known.get(key);
    };
    const run = async (pairs: Array<[string, string]>) => {
      const todo = pairs.filter(
        ([a, b]) =>
          SHA.test(a) && SHA.test(b) && compare(a, b) === undefined && !failed.has(`${a}...${b}`),
      );
      const absent = new Set(await mirror.missing(todo.flat()));
      await eachAtMost(CONCURRENCY, todo, async ([from, to]) => {
        const key = `${from}...${to}`;
        const lacking = [from, to].filter((c) => absent.has(c.toLowerCase()));
        if (lacking.length > 0) {
          failed.set(key, `${lacking.map((c) => c.slice(0, 9)).join(", ")} not in the mirror`);
          return;
        }
        try {
          const cmp = await compareInMirror(mirror, from, to);
          known.set(key, cmp);
          computed.push({ from, to, cmp });
        } catch (err) {
          failed.set(key, reason(err));
        }
      });
    };
    let laid = layout(inputs, compare, opts.checkedAt);
    for (let round = 0; round < MAX_WALK_ROUNDS; round++) {
      const pending = laid.missing.filter(([a, b]) => !failed.has(`${a}...${b}`));
      if (pending.length === 0) break;
      await run(pending);
      laid = layout(inputs, compare, opts.checkedAt);
    }
    const ofDeployments = deploymentPairs(laid.graph, deploymentCommits);
    await run(ofDeployments);

    // What could not be compared, said once: an impl PR's head may not be in this repository at
    // all, and a deployment's commit the mirror cannot have fails against every layer alike, so
    // those are summed up; any other pair is its own line.
    const implHeads = new Set(impl.map((cr) => cr.head));
    const implFailed: string[] = [];
    for (const [key, why] of failed) {
      const [from, to] = key.split("...") as [string, string];
      if (deploymentCommits.includes(to)) continue;
      if (implHeads.has(to)) implFailed.push(why);
      else errors.push(`${repo}: ${from.slice(0, 9)}...${to.slice(0, 9)} not compared: ${why}`);
    }
    if (implFailed.length > 0) {
      errors.push(
        `${repo}: ${implFailed.length} impl PR heads not compared with ${project.base}: ${implFailed[0]}`,
      );
    }
    for (const commit of deploymentCommits) {
      const pairs = ofDeployments.filter(([, to]) => to === commit);
      const why = pairs.map(([a, b]) => failed.get(`${a}...${b}`));
      if (pairs.length > 0 && why.every((w) => w !== undefined)) {
        errors.push(`deployment commit ${commit} not compared with any layer: ${why[0]}`);
      }
    }
    return {
      pulls: pullsRead,
      openOf: [repo, ...originPulls.keys()],
      comparisons: computed,
      layout: laid,
      inputs,
      errors,
    };
  }
}

function openPullOf(cr: ChangeRequest): OpenPull {
  return {
    number: cr.number,
    url: cr.url,
    title: cr.title,
    draft: cr.draft,
    branch: cr.branch,
    head: cr.head,
    base: cr.base,
  };
}

/** The merged or closed PR on a branch: the latest merge, else the latest close. */
function latestShut(found: readonly ChangeRequest[], branch: string): ShutPull | null {
  const on = found.filter((cr) => cr.branch === branch && cr.state !== "open");
  const latest = (state: "merged" | "closed") =>
    on
      .filter((cr) => cr.state === state)
      .sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""))[0];
  const pick = latest("merged") ?? latest("closed");
  return pick === undefined
    ? null
    : { number: pick.number, state: pick.state as ShutPull["state"], base: pick.base };
}
