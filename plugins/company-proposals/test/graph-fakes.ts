/**
 * Fakes of the graph's ports for the tests: a Forge answering from a list of change requests,
 * and a GitMirror answering from a map of refs and a table of comparisons — each counting its
 * calls, so a test can say what a refresh asked and what it did not.
 */
import type {
  ChangeRequest,
  ChangeRequestQuery,
  Forge,
  GitMirror,
  RemoteRefs,
} from "../src/ports.js";
import type { Comparison } from "../src/pr-chain.js";

/** A change request with the fields a test rarely cares about filled in. */
export function cr(
  repo: string,
  number: number,
  fields: Partial<ChangeRequest> & { head: string; branch: string },
): ChangeRequest {
  return {
    repo,
    number,
    url: `https://github.com/${repo}/pull/${number}`,
    title: `PR ${number}`,
    state: "open",
    draft: false,
    base: "dev",
    closedAt: null,
    defaultBranch: "main",
    ...fields,
  };
}

export class FakeForge implements Forge {
  readonly kind = "github" as const;
  readonly queries: ChangeRequestQuery[] = [];
  /** Throws instead of answering, when set. */
  failWith: string | null = null;

  constructor(public pulls: ChangeRequest[] = []) {}

  async listChangeRequests(q: ChangeRequestQuery): Promise<ChangeRequest[]> {
    this.queries.push(q);
    if (this.failWith !== null) throw new Error(this.failWith);
    const same = (cr: ChangeRequest) => cr.repo.toLowerCase() === q.repo.toLowerCase();
    const out: ChangeRequest[] = [];
    if (q.open === true) out.push(...this.pulls.filter((p) => same(p) && p.state === "open"));
    for (const branch of q.shutOn ?? []) {
      out.push(...this.pulls.filter((p) => same(p) && p.branch === branch && p.state !== "open"));
    }
    for (const n of q.numbers ?? []) {
      out.push(...this.pulls.filter((p) => same(p) && p.number === n));
    }
    return out;
  }

  parseUrl(url: string): { repo: string; number: number } | null {
    const m = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(url);
    return m === null ? null : { repo: m[1]!, number: Number(m[2]) };
  }

  webUrl(repo: string, number: number): string {
    return `https://github.com/${repo}/pull/${number}`;
  }

  async isMerged(url: string) {
    if (this.failWith !== null) return null;
    const ref = this.parseUrl(url);
    const pull = this.pulls.find(
      (p) =>
        ref !== null && p.repo.toLowerCase() === ref.repo.toLowerCase() && p.number === ref.number,
    );
    if (pull === undefined) return null;
    const status =
      pull.state === "open" ? (pull.draft ? ("draft" as const) : ("open" as const)) : pull.state;
    return {
      status,
      base: pull.base,
      defaultBranch: pull.defaultBranch,
      landed: pull.state === "merged" && pull.base === pull.defaultBranch,
    };
  }
}

export class FakeMirror implements GitMirror {
  lsRemoteCalls = 0;
  readonly fetched: string[][] = [];
  readonly compared: Array<[string, string]> = [];
  /** Commits the mirror holds; a fetch adds the commit of each ref it names. */
  readonly objects = new Set<string>();
  /** Bare commits a fetch can bring (a deployment's, pushed somewhere the remote has it). */
  readonly reachable = new Set<string>();
  failWith: string | null = null;
  /** Each commit's parents, for the heads' ancestry walk; a commit not listed has none. */
  readonly parents = new Map<string, string[]>();
  /** The ancestry walks asked for. */
  walks = 0;

  constructor(
    public refs: Map<string, string> = new Map(),
    public head: string | null = "main",
    /** `from...to` → the comparison the mirror computes. */
    public comparisons: Map<string, Comparison> = new Map(),
  ) {}

  async lsRemote(): Promise<RemoteRefs> {
    this.lsRemoteCalls++;
    if (this.failWith !== null) throw new Error(this.failWith);
    return { refs: new Map(this.refs), head: this.head };
  }

  async fetch(refs: readonly string[]): Promise<void> {
    if (refs.length === 0) return;
    this.fetched.push([...refs]);
    // A ref brings its commit; a bare commit only when the remote has it (`reachable`).
    for (const r of refs) {
      const oid = this.refs.get(r) ?? (this.reachable.has(r) ? r : undefined);
      if (oid !== undefined) this.objects.add(oid);
    }
  }

  async missing(oids: readonly string[]): Promise<string[]> {
    return [...new Set(oids.map((o) => o.toLowerCase()))].filter((o) => !this.objects.has(o));
  }

  private cmp(from: string, to: string): Comparison {
    const found = this.comparisons.get(`${from}...${to}`);
    if (found === undefined) throw new Error(`no comparison ${from}...${to}`);
    return found;
  }

  async isAncestor(a: string, b: string): Promise<boolean> {
    const c = this.cmp(a, b);
    return c.relation === "ahead" || c.relation === "same";
  }

  async mergeBase(a: string, b: string): Promise<string | null> {
    return this.cmp(a, b).mergeBase;
  }

  async treeEquals(a: string, b: string): Promise<boolean> {
    return a === b || this.comparisons.get(`${a}...${b}`)?.empty === true;
  }

  async commitsBeyond(heads: readonly string[], base: string): Promise<Map<string, string[]>> {
    this.walks++;
    const closure = (from: readonly string[]) => {
      const seen = new Set<string>();
      const todo = [...from];
      while (todo.length > 0) {
        const c = todo.pop()!;
        if (seen.has(c)) continue;
        seen.add(c);
        todo.push(...(this.parents.get(c) ?? []));
      }
      return seen;
    };
    const inBase = closure([base]);
    const out = new Map<string, string[]>();
    for (const c of closure(heads)) if (!inBase.has(c)) out.set(c, this.parents.get(c) ?? []);
    return out;
  }

  async counts(from: string, to: string): Promise<{ ahead: number; behind: number }> {
    this.compared.push([from, to]);
    const c = this.cmp(from, to);
    return { ahead: c.ahead, behind: c.behind };
  }
}

/** A comparison a test names by its relation. */
export function rel(
  relation: Comparison["relation"],
  ahead: number,
  behind = 0,
  mergeBase: string | null = null,
): Comparison {
  return { relation, ahead, behind, mergeBase, empty: false };
}
