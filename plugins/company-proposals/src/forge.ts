/**
 * The Forge port's adapters. `github` reads change requests in batches through the machine's
 * `gh` (`gh api graphql`), so it runs under whatever identity `gh auth` holds there — no token
 * of the server's. `none` is the forge of a project without one: no change requests, and
 * "unknown" for whether one is merged, so only a person and the implementer report merged.
 */
import type { ChangeRequest, ChangeRequestQuery, Forge } from "./ports.js";
import { ghRunner, GITHUB_NAME, parsePullUrl, statusOfChange, type RunGh } from "./pr-status.js";

/** A GraphQL read: ten seconds. */
export const GRAPHQL_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
/** Pages of a hundred open change requests read at most. */
const MAX_PAGES = 10;
/** Branches or numbers asked in one query. */
const BATCH = 50;

const FIELDS = `number title url isDraft state headRefName headRefOid baseRefName closedAt
  baseRepository { defaultBranchRef { name } }`;

interface Node {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  state: "OPEN" | "MERGED" | "CLOSED";
  headRefName: string;
  headRefOid: string;
  baseRefName: string;
  closedAt: string | null;
  baseRepository?: { defaultBranchRef?: { name?: string } | null } | null;
}

function changeRequestOf(repo: string, n: Node): ChangeRequest {
  return {
    repo,
    number: n.number,
    url: n.url,
    title: n.title,
    state: n.state === "MERGED" ? "merged" : n.state === "CLOSED" ? "closed" : "open",
    draft: n.isDraft === true,
    branch: n.headRefName,
    head: n.headRefOid.toLowerCase(),
    base: n.baseRefName,
    closedAt: n.closedAt,
    defaultBranch: n.baseRepository?.defaultBranchRef?.name ?? null,
  };
}

function splitRepo(repo: string): [string, string] {
  const [owner, name] = repo.split("/");
  if (owner === undefined || name === undefined || !GITHUB_NAME.test(owner) || !GITHUB_NAME.test(name)) {
    throw new Error(`${repo}: not a GitHub repository name`);
  }
  return [owner, name];
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export class GithubForge implements Forge {
  readonly kind = "github" as const;
  private readonly run: RunGh;

  constructor(gh?: RunGh) {
    this.run = gh ?? ghRunner();
  }

  private async graphql<T>(query: string): Promise<T> {
    const stdout = await this.run(["api", "graphql", "-f", `query=${query}`], {
      timeoutMs: GRAPHQL_TIMEOUT_MS,
      maxBytes: MAX_OUTPUT_BYTES,
    });
    const body = JSON.parse(stdout) as { data?: T; errors?: Array<{ message?: string }> };
    if (body.data === undefined || body.data === null) {
      throw new Error(body.errors?.[0]?.message ?? "no data in the GraphQL answer");
    }
    return body.data;
  }

  parseUrl(url: string): { repo: string; number: number } | null {
    const ref = parsePullUrl(url);
    return ref === null ? null : { repo: `${ref.owner}/${ref.repo}`, number: ref.number };
  }

  webUrl(repo: string, number: number): string {
    return `https://github.com/${repo}/pull/${number}`;
  }

  async listChangeRequests(q: ChangeRequestQuery): Promise<ChangeRequest[]> {
    const [owner, name] = splitRepo(q.repo);
    const repoArgs = `owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}`;
    const out: ChangeRequest[] = [];
    if (q.open === true) {
      let after: string | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const data: {
          repository: {
            pullRequests: { nodes: Node[]; pageInfo: { hasNextPage: boolean; endCursor: string } };
          };
        } = await this.graphql(
          `query { repository(${repoArgs}) { pullRequests(states: OPEN, first: 100${after === null ? "" : `, after: ${JSON.stringify(after)}`}) { nodes { ${FIELDS} } pageInfo { hasNextPage endCursor } } } }`,
        );
        const prs = data.repository.pullRequests;
        out.push(...prs.nodes.map((n) => changeRequestOf(q.repo, n)));
        if (!prs.pageInfo.hasNextPage) break;
        after = prs.pageInfo.endCursor;
      }
    }
    for (const batch of chunks(q.shutOn ?? [], BATCH)) {
      const fields = batch
        .map(
          (branch, i) =>
            `b${i}: pullRequests(headRefName: ${JSON.stringify(branch)}, states: [MERGED, CLOSED], first: 20, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { ${FIELDS} } }`,
        )
        .join(" ");
      const data = await this.graphql<{ repository: Record<string, { nodes: Node[] }> }>(
        `query { repository(${repoArgs}) { ${fields} } }`,
      );
      for (const v of Object.values(data.repository)) {
        out.push(...v.nodes.map((n) => changeRequestOf(q.repo, n)));
      }
    }
    for (const batch of chunks(q.numbers ?? [], BATCH)) {
      out.push(...(await this.byNumbers(q.repo, repoArgs, batch)));
    }
    return out;
  }

  /** Numbers in one query; when one of them fails the whole answer (a number that is no PR), each is asked alone. */
  private async byNumbers(repo: string, repoArgs: string, numbers: number[]): Promise<ChangeRequest[]> {
    const ask = async (list: number[]) => {
      const fields = list.map((n) => `n${n}: pullRequest(number: ${n}) { ${FIELDS} }`).join(" ");
      const data = await this.graphql<{ repository: Record<string, Node | null> }>(
        `query { repository(${repoArgs}) { ${fields} } }`,
      );
      return Object.values(data.repository)
        .filter((n): n is Node => n !== null)
        .map((n) => changeRequestOf(repo, n));
    };
    try {
      return await ask(numbers);
    } catch (err) {
      if (numbers.length === 1) throw err;
      const out: ChangeRequest[] = [];
      for (const n of numbers) out.push(...(await ask([n]).catch(() => [])));
      return out;
    }
  }

  async isMerged(url: string) {
    const ref = this.parseUrl(url);
    if (ref === null) return null;
    try {
      const [cr] = await this.listChangeRequests({ repo: ref.repo, numbers: [ref.number] });
      if (cr === undefined) return null;
      const status = statusOfChange(cr);
      return {
        status,
        base: cr.base,
        defaultBranch: cr.defaultBranch,
        landed: status === "merged" && cr.defaultBranch !== null && cr.base === cr.defaultBranch,
      };
    } catch {
      return null;
    }
  }
}

/** The forge of a project without one. */
export class NoForge implements Forge {
  readonly kind = "none" as const;
  async listChangeRequests(): Promise<ChangeRequest[]> {
    return [];
  }
  parseUrl(): null {
    return null;
  }
  webUrl(repo: string, number: number): string {
    return `${repo}#${number}`;
  }
  async isMerged(): Promise<null> {
    return null;
  }
}
