/**
 * The PR graph's GitHub side: the delivery repository's open PRs, the base branch's tip, the
 * merged or closed PRs a declared base leads through, the impl PRs that are not open there, and
 * the comparisons between heads (a registered server's commit among them) — read through the
 * machine's `gh`, like the PR status (pr-status.ts), and handed to buildGraph (pr-chain.ts),
 * which lays them out. The server fetches nothing and writes no git ref.
 *
 * A PR list, a branch tip, a branch's closed PRs or one PR is kept for a minute; a comparison of
 * two commits never changes, so it is kept for as long as the reader lives (up to a bound). A
 * lookup that fails leaves its part of the graph `unknown` and is listed in `errors`.
 */
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
import { ghRunner, parsePullUrl, STATUS_TTL_MS, type RunGh } from "./pr-status.js";
import type { ServerReading } from "./servers.js";

const TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
/** Enough for the open PRs of one repository: ten pages of a hundred. */
const MAX_PAGES = 10;
const CONCURRENCY = 8;
/** Comparisons kept; past this the oldest are dropped. */
const MAX_COMPARISONS = 5000;

const PULLS_JQ =
  "[.[] | {number, title, draft, url: .html_url, branch: .head.ref, head: .head.sha, base: .base.ref}]";
const COMPARE_JQ =
  "{status, ahead_by, behind_by, merge_base: .merge_base_commit.sha, empty: (.merge_base_commit.commit.tree.sha == .base_commit.commit.tree.sha)}";
const SHUT_JQ =
  '[.[] | {number, merged: (.merged_at != null), at: (.merged_at // .closed_at // ""), base: .base.ref}]';
const PULL_JQ =
  "{merged: (.merged_at != null), state, branch: .head.ref, head: .head.sha, base: .base.ref}";
/** Rounds of looking up the merged or closed PRs a walk from a declared base passes through. */
const MAX_WALK_ROUNDS = 20;
const GITHUB_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA = /^[0-9a-f]{7,64}$/i;

interface Timed<T> {
  value: T;
  at: number;
}

export interface PrGraphDeps {
  gh?: RunGh;
  now?: () => number;
}

/** The GitHub side of the graph, with its caches; one per service. */
export class PrGraphReader {
  private readonly lists = new Map<string, Timed<OpenPull[]>>();
  private readonly tips = new Map<string, Timed<string>>();
  private readonly defaults = new Map<string, Timed<string>>();
  private readonly shut = new Map<string, Timed<ShutPull | null>>();
  private readonly pulls = new Map<string, Timed<ImplPull>>();
  private readonly comparisons = new Map<string, Comparison>();
  private readonly run: RunGh;

  constructor(private readonly deps: PrGraphDeps = {}) {
    this.run = deps.gh ?? ghRunner();
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /**
   * Reads what the graph needs from GitHub and lays it out. With no repository (`""`) the
   * graph is the base branch alone, unread, and `errors` says why.
   */
  async read(config: {
    repo: string;
    base: string;
    origins: Array<{ name: string; repo: string }>;
    proposals: GraphProposal[];
    servers?: ServerReading[];
    errors?: string[];
  }): Promise<ProposalGraphResponse> {
    const servers = config.servers ?? [];
    const errors: string[] = [...(config.errors ?? [])];
    if (config.repo === "") {
      return buildGraph({
        repo: "",
        base: { branch: config.base, head: null },
        pulls: [],
        origins: config.origins.map((o) => ({ ...o, pulls: null })),
        compare: () => undefined,
        proposals: config.proposals,
        servers,
        errors,
        checkedAt: new Date(this.now()).toISOString(),
      });
    }
    const [pulls, head, ...originPulls] = await Promise.all([
      this.openPulls(config.repo, errors),
      this.branchTip(config.repo, config.base, errors),
      ...config.origins.map((o) =>
        o.repo.toLowerCase() === config.repo.toLowerCase()
          ? Promise.resolve(null)
          : this.openPulls(o.repo, errors),
      ),
    ]);
    const list = pulls ?? [];
    const origins = config.origins.map((o, i) => ({ ...o, pulls: originPulls[i] ?? null }));

    // The branches the declared bases lead to that no open PR has: each round looks up the
    // merged or closed PR on them and walks on from its base (rules 1 and 1a).
    const shut = new Map<string, ShutPull | null>();
    for (let round = 0; round < MAX_WALK_ROUNDS; round++) {
      const missing = new Set<string>();
      for (const p of parentsOf(list, shut, config.base).values()) {
        if (p.missing !== null) missing.add(p.missing);
      }
      if (missing.size === 0) break;
      await this.shutOnBranches(config.repo, [...missing], shut, errors);
    }

    // Each impl PR that is not an open PR here, as GitHub answers it — unless the open PRs
    // themselves could not be read: then every impl PR would look off the graph, and none is asked.
    const open = new Set(list.map((p) => `${config.repo.toLowerCase()}#${p.number}`));
    const offGraph = config.proposals
      .filter((p) => p.status !== "rejected" && p.implPr !== null)
      .map((p) => p.implPr!)
      .filter((url) => !open.has(pullKey(url) ?? ""));
    const implPulls =
      pulls === null ? new Map<string, ImplPull | null>() : await this.implPulls(offGraph, errors);
    const implHeads = new Set([...implPulls.values()].flatMap((p) => (p === null ? [] : [p.head])));

    // buildGraph asks for the comparisons it needs — each edge, an edge that fails alone against
    // the grandparent's head (rule 2a), each origin's twin, each off-graph impl PR against the
    // base branch, each server's commit against every layer's head unless it is one of them —
    // and the graph is laid out again once they are read. Within one read a pair is asked once.
    // An impl PR's head may not be in this repository at all, so those failures are summed up in
    // one line instead of one per PR; a server's commit GitHub does not have fails every
    // comparison the same way, so one line per server says so instead of one per layer.
    const asked = new Set<string>();
    const implFailures: string[] = [];
    const serverCommits = new Set(
      servers.flatMap((s) => (s.commit === null ? [] : [s.commit.toLowerCase()])),
    );
    const serverFailures = new Map<string, string[]>();
    let pending: Array<[string, string]> = [];
    const layout = (): ProposalGraphResponse =>
      buildGraph({
        repo: config.repo,
        base: { branch: config.base, head },
        pulls: list,
        origins,
        shut,
        compare: (from, to) => {
          const key = `${from}...${to}`;
          const found = this.comparisons.get(key);
          if (found === undefined && !asked.has(key)) {
            asked.add(key);
            pending.push([from, to]);
          }
          return found;
        },
        proposals: config.proposals,
        implPulls,
        servers,
        errors,
        checkedAt: new Date(this.now()).toISOString(),
      });
    let graph = layout();
    while (pending.length > 0) {
      const batch = pending.filter(([, to]) => !serverCommits.has(to));
      const ofServer = pending.filter(([, to]) => serverCommits.has(to));
      pending = [];
      const ofImpl = batch.filter(([, to]) => implHeads.has(to));
      await this.compareAll(
        config.repo,
        batch.filter(([, to]) => !implHeads.has(to)),
        errors,
      );
      await this.compareAll(config.repo, ofImpl, implFailures);
      for (const commit of new Set(ofServer.map(([, to]) => to))) {
        const failed = serverFailures.get(commit) ?? [];
        serverFailures.set(commit, failed);
        await this.compareAll(
          config.repo,
          ofServer.filter(([, to]) => to === commit),
          failed,
        );
      }
      graph = layout();
    }
    const heads = [head, ...list.map((p) => p.head)].filter((h): h is string => h !== null);
    for (const server of servers) {
      const commit = server.commit?.toLowerCase();
      const failed = commit === undefined ? [] : (serverFailures.get(commit) ?? []);
      if (heads.length > 0 && failed.length === heads.length) {
        errors.push(
          `server ${server.name}: commit ${commit} not compared with any layer: ${failed[0]!.split(" not compared: ")[1] ?? failed[0]}`,
        );
      }
    }
    if (implFailures.length > 0) {
      errors.push(
        `${config.repo}: ${implFailures.length} impl PR heads not compared with ${config.base}: ${implFailures[0]!.split(" not compared: ")[1] ?? implFailures[0]}`,
      );
    }
    return graph;
  }

  /** The merged or closed PR on each branch, the latest merge before the latest close; null for none or a failed lookup. */
  private async shutOnBranches(
    repo: string,
    branches: string[],
    into: Map<string, ShutPull | null>,
    errors: string[],
  ): Promise<void> {
    const owner = repo.split("/")[0]!;
    await eachAtMost(CONCURRENCY, branches, async (branch) => {
      const key = `${repo}@${branch}`;
      const cached = this.shut.get(key);
      if (cached !== undefined && this.now() - cached.at < STATUS_TTL_MS) {
        into.set(branch, cached.value);
        return;
      }
      try {
        const found = await this.gh<
          Array<{ number: number; merged: boolean; at: string; base: string }>
        >([
          "api",
          `repos/${repo}/pulls?state=closed&per_page=100&head=${encodeURIComponent(`${owner}:${branch}`)}`,
          "--jq",
          SHUT_JQ,
        ]);
        const latest = (merged: boolean) =>
          found.filter((p) => p.merged === merged).sort((a, b) => b.at.localeCompare(a.at))[0];
        const pick = latest(true) ?? latest(false);
        const value: ShutPull | null =
          pick === undefined
            ? null
            : { number: pick.number, state: pick.merged ? "merged" : "closed", base: pick.base };
        this.shut.set(key, { value, at: this.now() });
        into.set(branch, value);
      } catch (err) {
        errors.push(`${repo}: closed PRs on ${branch} not read: ${reason(err)}`);
        into.set(branch, null);
      }
    });
  }

  /** Each impl PR URL's PR, by pullKey; null when it is not a GitHub PR or could not be read. */
  private async implPulls(urls: string[], errors: string[]): Promise<Map<string, ImplPull | null>> {
    const out = new Map<string, ImplPull | null>();
    const refs = new Map(
      urls.flatMap((url) => {
        const ref = parsePullUrl(url);
        const key = pullKey(url);
        return ref === null || key === null ? [] : [[key, ref] as const];
      }),
    );
    const failures: string[] = [];
    await eachAtMost(CONCURRENCY, [...refs], async ([key, ref]) => {
      const cached = this.pulls.get(key);
      if (cached !== undefined && this.now() - cached.at < STATUS_TTL_MS) {
        out.set(key, cached.value);
        return;
      }
      const repo = `${ref.owner}/${ref.repo}`;
      if (!GITHUB_REPO.test(repo)) {
        out.set(key, null);
        return;
      }
      try {
        const body = await this.gh<{
          merged: boolean;
          state: string;
          branch: string;
          head: string;
          base: string;
        }>(["api", `repos/${repo}/pulls/${ref.number}`, "--jq", PULL_JQ]);
        const value: ImplPull = {
          state: body.merged ? "merged" : body.state === "closed" ? "closed" : "open",
          branch: body.branch,
          head: body.head,
          base: body.base,
        };
        this.pulls.set(key, { value, at: this.now() });
        out.set(key, value);
      } catch (err) {
        failures.push(`${key}: ${reason(err)}`);
        out.set(key, null);
      }
    });
    if (failures.length > 0) {
      errors.push(`${failures.length} impl PRs not read: ${failures.sort()[0]}`);
    }
    return out;
  }

  private async gh<T>(args: string[]): Promise<T> {
    const stdout = await this.run(args, { timeoutMs: TIMEOUT_MS, maxBytes: MAX_OUTPUT_BYTES });
    return JSON.parse(stdout) as T;
  }

  private async openPulls(repo: string, errors: string[]): Promise<OpenPull[] | null> {
    const cached = this.lists.get(repo);
    if (cached !== undefined && this.now() - cached.at < STATUS_TTL_MS) return cached.value;
    if (!GITHUB_REPO.test(repo)) {
      errors.push(`${repo}: not a GitHub repository name`);
      return null;
    }
    const all: OpenPull[] = [];
    try {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const batch = await this.gh<OpenPull[]>([
          "api",
          `repos/${repo}/pulls?state=open&per_page=100&page=${page}`,
          "--jq",
          PULLS_JQ,
        ]);
        all.push(...batch.map((p) => ({ ...p, draft: p.draft === true })));
        if (batch.length < 100) break;
      }
    } catch (err) {
      errors.push(`${repo}: open PRs not read: ${reason(err)}`);
      return null;
    }
    this.lists.set(repo, { value: all, at: this.now() });
    return all;
  }

  /** The repository's default branch, kept like a branch tip; null when it cannot be read. */
  async defaultBranch(repo: string, errors: string[]): Promise<string | null> {
    const cached = this.defaults.get(repo);
    if (cached !== undefined && this.now() - cached.at < STATUS_TTL_MS) return cached.value;
    if (!GITHUB_REPO.test(repo)) return null;
    try {
      const branch = await this.gh<string>([
        "api",
        `repos/${repo}`,
        "--jq",
        ".default_branch | tojson",
      ]);
      this.defaults.set(repo, { value: branch, at: this.now() });
      return branch;
    } catch (err) {
      errors.push(`${repo}: default branch not read: ${reason(err)}`);
      return null;
    }
  }

  private async branchTip(repo: string, branch: string, errors: string[]): Promise<string | null> {
    const key = `${repo}@${branch}`;
    const cached = this.tips.get(key);
    if (cached !== undefined && this.now() - cached.at < STATUS_TTL_MS) return cached.value;
    if (!GITHUB_REPO.test(repo)) return null;
    try {
      const sha = await this.gh<string>([
        "api",
        `repos/${repo}/branches/${branch.split("/").map(encodeURIComponent).join("/")}`,
        "--jq",
        ".commit.sha | tojson",
      ]);
      this.tips.set(key, { value: sha, at: this.now() });
      return sha;
    } catch (err) {
      errors.push(`${repo}: branch ${branch} not read: ${reason(err)}`);
      return null;
    }
  }

  /** Compares every pair not compared yet, a few at a time. */
  private async compareAll(
    repo: string,
    pairs: Array<[string, string]>,
    errors: string[],
  ): Promise<void> {
    const todo = [
      ...new Map(
        pairs
          .filter(([a, b]) => SHA.test(a) && SHA.test(b))
          .map(([a, b]) => [`${a}...${b}`, [a, b] as const]),
      ).values(),
    ].filter(([a, b]) => !this.comparisons.has(`${a}...${b}`));
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < todo.length) {
        const [from, to] = todo[next++]!;
        try {
          const body = await this.gh<{
            status?: string;
            ahead_by?: number;
            behind_by?: number;
            merge_base?: string | null;
            empty?: boolean;
          }>(["api", `repos/${repo}/compare/${from}...${to}`, "--jq", COMPARE_JQ]);
          const relation =
            body.status === "identical"
              ? "same"
              : body.status === "ahead" || body.status === "behind" || body.status === "diverged"
                ? body.status
                : null;
          if (relation === null) throw new Error(`unexpected status ${String(body.status)}`);
          if (this.comparisons.size >= MAX_COMPARISONS) {
            this.comparisons.delete(this.comparisons.keys().next().value!);
          }
          this.comparisons.set(`${from}...${to}`, {
            relation,
            ahead: body.ahead_by ?? 0,
            behind: body.behind_by ?? 0,
            mergeBase: body.merge_base ?? null,
            empty: body.empty === true,
          });
        } catch (err) {
          errors.push(
            `${repo}: ${from.slice(0, 9)}...${to.slice(0, 9)} not compared: ${reason(err)}`,
          );
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  }
}

/** Runs `task` over `items`, at most `limit` at a time. */
async function eachAtMost<T>(
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
