/**
 * The pull request a Workspace is currently working on.
 *
 * Two sources, in order. `gh` first, because it speaks for the user: it already holds their
 * authentication, already knows the remote, and reaches private repositories — and nothing
 * here has to store a credential to get that. Where there is no `gh`, or it cannot speak for
 * anyone, GitHub's REST API answers instead: anonymously, which covers public repositories,
 * or with `GH_TOKEN` / `GITHUB_TOKEN` when the environment has one. A machine that only ever
 * runs an agent is unlikely to have `gh` installed, and that is the common case, not the edge.
 *
 * `gh`'s own credential store is deliberately not read. It belongs to another program, and a
 * chip in a header is not a reason to go through somebody's secrets.
 *
 * Silence is the whole failure policy. No PR for the branch, no `gh` and no reachable API, not
 * signed in anywhere, not a repository, not GitHub, no network: every one of them yields
 * `null`. A Workspace with nothing to say about a PR is the ordinary case, and a header chip
 * is not a place to report a problem the reader did not ask about.
 */
import { execFile } from "node:child_process";
import { Component } from "@prismshadow/penguin-core/kernel";
import type { PullRequests } from "../mechanisms/workspace.js";

/** How long an answer is reused for one (workspace, branch). */
export const PR_CACHE_TTL_MS = 30_000;

/** `gh` gets this long before it is killed; a hung CLI must not hold a request open. */
export const GH_TIMEOUT_MS = 10_000;

/** What the chip needs, and nothing else. */
export interface WorkspacePullRequest {
  number: number;
  title: string;
  url: string;
}

/**
 * The fields asked of `gh`. `headRefName` is not displayed: it is checked against the branch
 * the Workspace is actually on, because `gh pr view` resolves a branch to a PR through its own
 * remote-tracking rules and can answer with one whose head is a different branch.
 */
export const PR_VIEW_FIELDS = "number,title,url,state,headRefName";

/** `gh pr view --json ...`, as argv. */
export function prViewArgs(): string[] {
  return ["pr", "view", "--json", PR_VIEW_FIELDS];
}

/** `git rev-parse --abbrev-ref HEAD`, as argv. */
export function currentBranchArgs(): string[] {
  return ["rev-parse", "--abbrev-ref", "HEAD"];
}

/**
 * The environment every CLI call runs under: a prompt would hang a request that has no
 * terminal to answer it, which is the failure this prevents rather than diagnoses.
 */
export function cliEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1" };
}

/** A field, or its empty value: a newer `gh` renaming something must not blank the chip. */
function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * The PR to show for a Workspace on `branch`, or null.
 *
 * Only an OPEN pull request whose head is that branch counts. A merged or closed one is not
 * what the Workspace is working on, and a head that does not match is `gh` having resolved
 * through a tracking branch to somebody else's PR, most often the base branch's.
 */
export function pullRequestFrom(stdout: string, branch: string): WorkspacePullRequest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const view = parsed as Record<string, unknown>;
  if (str(view.state).toUpperCase() !== "OPEN") return null;
  if (str(view.headRefName) !== branch) return null;
  const number = typeof view.number === "number" ? view.number : 0;
  const url = str(view.url);
  if (!Number.isInteger(number) || number <= 0 || url === "") return null;
  return { number, title: str(view.title), url };
}

/**
 * What one command did. A failure is not one thing: `gh` that is not installed and `gh` that
 * answered "no pull requests found" mean opposite things here — the first says ask somebody
 * else, the second is the answer.
 */
export type CliResult =
  { ok: true; stdout: string } | { ok: false; missing: boolean; output: string };

/** Runs one command in `cwd`. Never throws. */
export type RunCli = (file: string, args: string[], cwd: string) => Promise<CliResult>;

const runCli: RunCli = (file, args, cwd) =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      { cwd, timeout: GH_TIMEOUT_MS, env: cliEnv(process.env), maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err === null) {
          resolve({ ok: true, stdout });
          return;
        }
        const code = (err as NodeJS.ErrnoException).code;
        resolve({ ok: false, missing: code === "ENOENT", output: `${stderr}${err.message}` });
      },
    );
  });

/**
 * Whether `gh` failed in a way that says nothing about the pull request — it is not there, or
 * it is there and cannot speak for the user. Either way another source may still know.
 *
 * `gh`'s own words are the signal, matched loosely: the exact phrasing is not a contract, and
 * a miss here costs a fallback that was not needed rather than a wrong answer.
 */
export function ghUnusable(result: CliResult): boolean {
  if (result.ok) return false;
  if (result.missing) return true;
  const said = result.output.toLowerCase();
  return (
    said.includes("gh auth login") ||
    said.includes("not logged into") ||
    said.includes("authentication failed") ||
    said.includes("bad credentials") ||
    said.includes("http 401")
  );
}

/** `git config --get remote.origin.url`, as argv. */
export function remoteUrlArgs(): string[] {
  return ["config", "--get", "remote.origin.url"];
}

/**
 * The GitHub repository a remote URL names, or null.
 *
 * Only github.com, in the three spellings git writes: `git@github.com:o/r.git`,
 * `https://github.com/o/r.git` and `ssh://git@github.com/o/r`. Another host is not a repo
 * this can answer about — a GitLab Workspace shows nothing rather than something wrong.
 */
export function githubRepoFrom(remoteUrl: string): { owner: string; repo: string } | null {
  const url = remoteUrl.trim();
  const match =
    /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/.exec(url) ??
    /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(url);
  if (match === null) return null;
  const [, owner, repo] = match;
  if (!owner || !repo || repo.includes("/")) return null;
  return { owner, repo };
}

/** Where the REST fallback asks about the open PRs whose head is `branch`. */
export function pullsApiUrl(owner: string, repo: string, branch: string): string {
  const head = `${owner}:${branch}`;
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=open&head=${encodeURIComponent(head)}&per_page=10`;
}

/**
 * A token for the REST fallback, from the environment only. `gh`'s own credential store is
 * deliberately not read: it belongs to another program, and a feature that decorates a header
 * is not a reason to go looking through somebody's secrets. Without one the call is anonymous,
 * which answers for public repositories and is rate-limited per address — the cache is what
 * keeps that within its budget.
 */
export function apiToken(env: NodeJS.ProcessEnv): string | null {
  const token = env.GH_TOKEN?.trim() || env.GITHUB_TOKEN?.trim();
  return token ? token : null;
}

/** The PR to show, from the REST list response. Same rule as the CLI path: open, this head. */
export function pullRequestFromApi(body: unknown, branch: string): WorkspacePullRequest | null {
  if (!Array.isArray(body)) return null;
  for (const entry of body) {
    if (typeof entry !== "object" || entry === null) continue;
    const pr = entry as Record<string, unknown>;
    const head = pr.head as Record<string, unknown> | undefined;
    if (str(pr.state).toLowerCase() !== "open") continue;
    if (str(head?.ref) !== branch) continue;
    const number = typeof pr.number === "number" ? pr.number : 0;
    const url = str(pr.html_url);
    if (!Number.isInteger(number) || number <= 0 || url === "") continue;
    return { number, title: str(pr.title), url };
  }
  return null;
}

/** One GET; resolves to the parsed JSON body, or null on any failure (see the header). */
export type FetchJson = (url: string, headers: Record<string, string>) => Promise<unknown>;

const fetchJson: FetchJson = async (url, headers) => {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(GH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
};

interface CacheEntry {
  at: number;
  value: WorkspacePullRequest | null;
}

/**
 * Answers "which PR is this Workspace on", cached per (workspace, branch) for a short while.
 *
 * The cache is what makes this safe to ask for on every conversation open: without it each one
 * spawns two processes, and the answer changes on the timescale of somebody opening a pull
 * request, not of a render.
 */
@Component()
export class PullRequestService implements PullRequests {
  readonly #cache = new Map<string, CacheEntry>();

  constructor(
    private readonly run: RunCli = runCli,
    private readonly now: () => number = Date.now,
    private readonly get: FetchJson = fetchJson,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async forWorkspace(workspace: string): Promise<WorkspacePullRequest | null> {
    const branchOut = await this.run("git", currentBranchArgs(), workspace);
    const branch = branchOut.ok ? branchOut.stdout.trim() : "";
    // No branch, not a repository, or a detached HEAD: nothing a PR could be looked up by.
    if (branch === "" || branch === "HEAD") return null;

    const key = `${workspace} ${branch}`;
    const hit = this.#cache.get(key);
    if (hit !== undefined && this.now() - hit.at < PR_CACHE_TTL_MS) return hit.value;

    const value = await this.#lookUp(workspace, branch);
    this.#cache.set(key, { at: this.now(), value });
    return value;
  }

  /**
   * `gh` first, because it speaks for the user: it reaches private repositories, whichever
   * host it is signed in to, and it is the machine's own idea of who is asking. The REST
   * fallback is for a machine that has no `gh` — a remote one, most of them — and answers
   * about public repositories anonymously, or about anything a token in the environment sees.
   */
  async #lookUp(workspace: string, branch: string): Promise<WorkspacePullRequest | null> {
    const gh = await this.run("gh", prViewArgs(), workspace);
    if (gh.ok) return pullRequestFrom(gh.stdout, branch);
    // `gh` is there and spoke: "no pull requests found for branch ..." is an answer, not a gap.
    if (!ghUnusable(gh)) return null;
    return this.#fromApi(workspace, branch);
  }

  async #fromApi(workspace: string, branch: string): Promise<WorkspacePullRequest | null> {
    const remote = await this.run("git", remoteUrlArgs(), workspace);
    if (!remote.ok) return null;
    const repo = githubRepoFrom(remote.stdout);
    if (repo === null) return null;
    const token = apiToken(this.env);
    try {
      const body = await this.get(pullsApiUrl(repo.owner, repo.repo, branch), {
        accept: "application/vnd.github+json",
        "user-agent": "penguin-harness",
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      });
      return pullRequestFromApi(body, branch);
    } catch {
      // Private without a token, rate-limited, offline: one more way to have nothing to show.
      return null;
    }
  }
}
