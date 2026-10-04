/**
 * The PR graph's refresh reads (pr-graph.ts holds the facts and their layout): change request
 * metadata from the Forge, refs into the GitMirror — the base branch, every open PR's head, the
 * tip of every impl branch no PR is open on, the impl PRs' heads — and every comparison the
 * layout asks for, computed in that mirror: git ancestry, no GitHub compare.
 */
import type { ProposalGraphResponse } from "@prismshadow/penguin-server/api";
import { headsOf } from "./graph-heads.js";
import {
  parentsOf,
  type Comparison,
  type GraphProposal,
  type OpenPull,
  type ShutPull,
} from "./pr-chain.js";
import {
  MAX_WALK_ROUNDS,
  inputsOf,
  layout,
  offGraphImplPrs,
  tipsOf,
  type GraphFacts,
  type GraphInputs,
  type GraphProject,
  type Layout,
} from "./pr-graph.js";
import type { ChangeRequest, Forge, GitMirror, GraphStore } from "./ports.js";

/** Comparisons computed at once in the mirror. */
const CONCURRENCY = 8;
const SHA = /^[0-9a-f]{40}$/i;

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
    const tip = (branch: string) => opts.refs.get(`refs/heads/${branch}`) ?? null;
    const { heads } = headsOf({
      repo,
      baseBranch: project.base,
      pulls: openPulls,
      proposals: opts.proposals,
      tips: tipsOf({ tip }, repo, opts.proposals),
    });
    const shutRead = new Map<string, ShutPull | null>();
    for (let round = 0; round < MAX_WALK_ROUNDS; round++) {
      const missing = new Set<string>();
      for (const p of parentsOf(heads, shutRead, project.base).values()) {
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
        originPulls.set(
          o.repo,
          await forge.listChangeRequests({ repo: o.repo, open: true }, signal),
        );
      } catch (err) {
        errors.push(`${o.repo}: open PRs not read: ${reason(err)}`);
      }
    }

    // The refs the graph uses, fetched when the mirror lacks their commit: the base branch, each
    // impl branch with no PR, each open PR's head, each impl PR's head on this repository.
    const wanted = new Map<string, string>();
    const baseRef = `refs/heads/${project.base}`;
    const baseHead = opts.refs.get(baseRef) ?? null;
    if (baseHead !== null) wanted.set(baseRef, baseHead);
    for (const h of heads) if (h.pull === null) wanted.set(`refs/heads/${h.branch}`, h.head);
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
    const branches = new Set(heads.map((h) => h.branch));
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
        .catch((err: unknown) =>
          this.deps.log?.(`[company-proposals] deployment commits not fetched: ${reason(err)}`),
        );
    }

    // The facts as read, laid out; every comparison it asks for computed in the mirror, then
    // laid out again until nothing new is asked.
    const pullsRead = [...open, ...impl, ...[...originPulls.values()].flat()];
    const facts: GraphFacts = {
      baseHead,
      tip,
      openPulls: (r) =>
        r.toLowerCase() === repo.toLowerCase()
          ? openPulls
          : (originPulls
              .get(r)
              ?.filter((cr) => cr.state === "open")
              .map(openPullOf) ??
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
