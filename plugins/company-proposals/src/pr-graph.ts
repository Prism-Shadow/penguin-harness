/**
 * The PR graph: the delivery repository's open PRs laid out as a commit graph, each node
 * marked with the proposal whose impl PR it is and with the PR every other origin has on the
 * same branch.
 *
 * A node is an open PR's head commit; its edge goes to the head of its declared base (the PR
 * whose head branch that is, or the base branch's tip) and is checked against ancestry with
 * GitHub's compare — `baseRefName` is only a declaration. A head `ahead` of (or the same as)
 * its base's head is stacked; anything else is off the chain. The graph marks the chain's
 * forks and, when there is exactly one, its top; it never picks between branches of a fork.
 *
 * Everything comes from GitHub through the machine's `gh`, like the PR status (pr-status.ts):
 * the server fetches nothing and writes no git ref. A PR list or a branch tip is kept for a
 * minute; a comparison of two commits never changes, so it is kept for as long as the reader
 * lives (up to a bound). A lookup that fails leaves its part of the graph `unknown` and is
 * listed in `errors`.
 */
import type {
  ProposalGraphNode,
  ProposalGraphOriginPr,
  ProposalGraphRelation,
  ProposalGraphResponse,
  ProposalStatus,
} from "@prismshadow/penguin-server/api";
import { ghRunner, parsePullUrl, STATUS_TTL_MS, type RunGh } from "./pr-status.js";

/** `owner/repo#n`, lower-cased owner and repo: how two URLs of one PR are recognised as one. */
export function pullKey(url: string): string | null {
  const ref = parsePullUrl(url);
  return ref === null ? null : `${ref.owner.toLowerCase()}/${ref.repo.toLowerCase()}#${ref.number}`;
}

/** An open PR as the graph needs it. */
export interface OpenPull {
  number: number;
  url: string;
  title: string;
  draft: boolean;
  branch: string;
  head: string;
  base: string;
}

/** Where `to` stands against `from` (GitHub's `compare/<from>...<to>`). */
export interface Comparison {
  relation: Exclude<ProposalGraphRelation, "unknown">;
  ahead: number;
  behind: number;
}

/** A proposal as the graph annotates with it. */
export interface GraphProposal {
  number: number;
  title: string;
  status: ProposalStatus;
  implPr: string | null;
}

/** Everything read from GitHub and the ledger, as plain data: what buildGraph lays out. */
export interface GraphInput {
  repo: string;
  base: { branch: string; head: string | null };
  pulls: OpenPull[];
  origins: Array<{ name: string; repo: string; pulls: OpenPull[] | null }>;
  /** A comparison read earlier; undefined when it was not (or could not be) read. */
  compare: (from: string, to: string) => Comparison | undefined;
  proposals: GraphProposal[];
  errors: string[];
  checkedAt: string;
}

const STACKED = new Set<ProposalGraphRelation>(["ahead", "same"]);

/** The layout: parents from the declared bases, the chain from the base branch, forks, the top, the annotations. */
export function buildGraph(input: GraphInput): ProposalGraphResponse {
  const byBranch = new Map(input.pulls.map((p) => [p.branch, p]));
  const byKey = new Map<string, GraphProposal>();
  for (const p of input.proposals) {
    const key = p.implPr === null ? null : pullKey(p.implPr);
    if (key !== null && p.status !== "rejected") byKey.set(key, p);
  }
  const repoKey = input.repo.toLowerCase();

  const nodes = new Map<number, ProposalGraphNode>();
  for (const pull of input.pulls) {
    const parentPull = byBranch.get(pull.base);
    const parent =
      parentPull !== undefined && parentPull.number !== pull.number
        ? parentPull.number
        : pull.base === input.base.branch
          ? 0
          : null;
    const baseHead =
      parent === null ? null : parent === 0 ? input.base.head : (parentPull?.head ?? null);
    const cmp = baseHead === null ? undefined : input.compare(baseHead, pull.head);
    const proposal = byKey.get(`${repoKey}#${pull.number}`) ?? null;
    nodes.set(pull.number, {
      number: pull.number,
      url: pull.url,
      title: pull.title,
      draft: pull.draft,
      branch: pull.branch,
      head: pull.head,
      base: pull.base,
      parent,
      relation: cmp?.relation ?? "unknown",
      ahead: cmp?.ahead ?? null,
      behind: cmp?.behind ?? null,
      onChain: false,
      fork: false,
      proposal:
        proposal === null
          ? null
          : { number: proposal.number, title: proposal.title, status: proposal.status },
      origins: originsOf(input, pull),
    });
  }

  // Stacked children per parent (0 = the base branch), in PR-number order.
  const children = new Map<number, number[]>();
  for (const n of [...nodes.values()].sort((a, b) => a.number - b.number)) {
    if (n.parent === null || !STACKED.has(n.relation)) continue;
    children.set(n.parent, [...(children.get(n.parent) ?? []), n.number]);
  }
  // Walk the chain from the base branch; the seen set guards a cycle of declared bases.
  const order: number[] = [];
  const leaves: number[] = [];
  const seen = new Set<number>();
  const walk = (at: number): void => {
    const kids = (children.get(at) ?? []).filter((k) => !seen.has(k));
    if (at !== 0 && kids.length === 0) leaves.push(at);
    for (const k of kids) {
      seen.add(k);
      order.push(k);
      walk(k);
    }
  };
  walk(0);
  for (const number of order) nodes.get(number)!.onChain = true;
  for (const [at, kids] of children) {
    if (at !== 0 && kids.length > 1 && nodes.has(at)) nodes.get(at)!.fork = true;
  }
  const offChain = [...nodes.keys()].filter((n) => !seen.has(n)).sort((a, b) => a - b);

  const placed = new Set([...nodes.keys()].map((n) => `${repoKey}#${n}`));
  const unplaced = input.proposals
    .filter((p) => p.status !== "rejected" && p.implPr !== null)
    .filter((p) => !placed.has(pullKey(p.implPr!) ?? ""))
    .sort((a, b) => a.number - b.number)
    .map((p) => ({ number: p.number, title: p.title, status: p.status, implPr: p.implPr! }));

  return {
    repo: input.repo,
    base: {
      branch: input.base.branch,
      head: input.base.head,
      fork: (children.get(0)?.length ?? 0) > 1,
    },
    origins: input.origins.map((o) => ({ name: o.name, repo: o.repo })),
    nodes: [...order, ...offChain].map((n) => nodes.get(n)!),
    top: leaves.length === 1 ? leaves[0]! : null,
    unplaced,
    errors: input.errors,
    checkedAt: input.checkedAt,
  };
}

/** Each origin's open PR on the node's branch, with its head against the node's. */
function originsOf(input: GraphInput, pull: OpenPull): ProposalGraphOriginPr[] {
  const out: ProposalGraphOriginPr[] = [];
  for (const origin of input.origins) {
    if (origin.repo.toLowerCase() === input.repo.toLowerCase()) continue;
    const twin = origin.pulls?.find((p) => p.branch === pull.branch);
    if (twin === undefined) continue;
    const relation: ProposalGraphRelation =
      twin.head === pull.head
        ? "same"
        : (input.compare(pull.head, twin.head)?.relation ?? "unknown");
    out.push({
      origin: origin.name,
      number: twin.number,
      url: twin.url,
      draft: twin.draft,
      head: twin.head,
      relation,
    });
  }
  return out;
}

const TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
/** Enough for the open PRs of one repository: ten pages of a hundred. */
const MAX_PAGES = 10;
const CONCURRENCY = 8;
/** Comparisons kept; past this the oldest are dropped. */
const MAX_COMPARISONS = 5000;

const PULLS_JQ =
  "[.[] | {number, title, draft, url: .html_url, branch: .head.ref, head: .head.sha, base: .base.ref}]";
const COMPARE_JQ = "{status, ahead_by, behind_by}";
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
  private readonly comparisons = new Map<string, Comparison>();
  private readonly run: RunGh;

  constructor(private readonly deps: PrGraphDeps = {}) {
    this.run = deps.gh ?? ghRunner();
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** Reads what the graph needs from GitHub and lays it out. */
  async read(config: {
    repo: string;
    base: string;
    origins: Array<{ name: string; repo: string }>;
    proposals: GraphProposal[];
  }): Promise<ProposalGraphResponse> {
    const errors: string[] = [];
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

    // The pairs to compare: each head against its declared base's head, and each origin's
    // twin head against the node's head.
    const byBranch = new Map(list.map((p) => [p.branch, p]));
    const pairs: Array<[string, string]> = [];
    for (const p of list) {
      const from = byBranch.get(p.base)?.head ?? (p.base === config.base ? head : null);
      if (from !== null && from !== undefined) pairs.push([from, p.head]);
      for (const o of origins) {
        const twin = o.pulls?.find((t) => t.branch === p.branch);
        if (twin !== undefined && twin.head !== p.head) pairs.push([p.head, twin.head]);
      }
    }
    await this.compareAll(config.repo, pairs, errors);

    return buildGraph({
      repo: config.repo,
      base: { branch: config.base, head },
      pulls: list,
      origins,
      compare: (from, to) => this.comparisons.get(`${from}...${to}`),
      proposals: config.proposals,
      errors,
      checkedAt: new Date(this.now()).toISOString(),
    });
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
          const body = await this.gh<{ status?: string; ahead_by?: number; behind_by?: number }>([
            "api",
            `repos/${repo}/compare/${from}...${to}`,
            "--jq",
            COMPARE_JQ,
          ]);
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

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
