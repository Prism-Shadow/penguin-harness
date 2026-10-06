/**
 * A proposal's impl branch: the head branch it is implemented on and the base that head is
 * measured against, each a `<remote, branch>` pair. The patch is the merge base of the two up
 * to the head — GitHub's `compare/<base>...<head>` — and the PR opened for the head, when there
 * is one, hangs on the pair.
 *
 * A remote is a git remote of the proposal's repository that points at GitHub (`origin`, read
 * from `git remote -v` like the PR graph's fallback, workspace-remotes.ts), or a GitHub
 * repository written out (`owner/repo`). An impl registered as a PR alone has no declared pair:
 * its head and base are the PR's, read from GitHub here when they are needed.
 *
 * Everything GitHub is asked goes through the machine's `gh`, like the PR graph; nothing is
 * fetched into the workspace and no git ref is written.
 */
import type {
  ProposalBranchRef,
  ProposalImplDiff,
  ProposalImplDiffFile,
  ProposalResolvedBranch,
} from "@prismshadow/penguin-server/api";
import { GITHUB_NAME, parsePullUrl, type RunGh } from "./pr-status.js";

/** A refusal the service turns into its own error, with the same status and code. */
export class ImplBranchError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ImplBranchError";
  }
}

/** A git remote name. */
const REMOTE_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
/** A GitHub repository written out as a remote. */
const GITHUB_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
/** A branch name: the characters git and GitHub both take without quoting, no `..`, no leading `-`. */
const BRANCH_NAME = /^(?!-)[A-Za-z0-9._/-]{1,200}$/;
const SHA = /^[0-9a-f]{40}$/;

const GH_TIMEOUT_MS = 15_000;
/** A comparison carries every file's patch; a large one is megabytes. */
const MAX_COMPARE_BYTES = 16 * 1024 * 1024;
const MAX_SMALL_BYTES = 1024 * 1024;
/** GitHub lists at most this many files of a comparison. */
export const COMPARE_FILE_LIMIT = 300;

/** `what` as a branch pair side, checked; throws 400 naming the field. */
export function branchRefOf(raw: unknown, what: string): ProposalBranchRef {
  const value = raw as { remote?: unknown; branch?: unknown } | null;
  const remote = typeof value?.remote === "string" ? value.remote.trim() : "";
  const branch = typeof value?.branch === "string" ? value.branch.trim() : "";
  if (!(REMOTE_NAME.test(remote) || isRepoRemote(remote))) {
    throw new ImplBranchError(
      400,
      "bad_request",
      `${what}.remote must be a git remote name or owner/repo, not ${JSON.stringify(remote)}.`,
    );
  }
  if (!BRANCH_NAME.test(branch) || branch.includes("..") || branch.endsWith("/")) {
    throw new ImplBranchError(
      400,
      "bad_request",
      `${what}.branch is not a branch name: ${JSON.stringify(branch)}.`,
    );
  }
  return { remote, branch };
}

function isRepoRemote(remote: string): boolean {
  if (!GITHUB_REPO.test(remote)) return false;
  const [owner, repo] = remote.split("/");
  return GITHUB_NAME.test(owner!) && GITHUB_NAME.test(repo!);
}

/** `<remote>/<branch>`, the way git names a remote branch. */
export function refLabel(ref: ProposalBranchRef): string {
  return `${ref.remote}/${ref.branch}`;
}

/**
 * A side's identity as sameRef compares it, and as the store indexes an impl's head
 * (`proposal_impls.head_key`): an `owner/repo` remote lower-cased, a remote name as it is.
 */
export function refKey(ref: ProposalBranchRef): string {
  const remote = isRepoRemote(ref.remote) ? ref.remote.toLowerCase() : ref.remote;
  return `${remote}:${ref.branch}`;
}

/** Two declared sides name the same branch (remote names compare as written, repositories case-insensitively). */
export function sameRef(a: ProposalBranchRef, b: ProposalBranchRef): boolean {
  return refKey(a) === refKey(b);
}

/** The GitHub repository a remote names: `owner/repo` itself, or the remote's fetch URL; null when it names none. */
export function repoOfRemote(
  remote: string,
  remotes: ReadonlyArray<{ name: string; repo: string }>,
): string | null {
  if (isRepoRemote(remote)) return remote;
  return remotes.find((r) => r.name === remote)?.repo ?? null;
}

/**
 * A declared side's page on GitHub, for the views: `owner/repo` written out is used as it is;
 * a remote name is looked up in the `origins` setting first, then in `remotes` — the shared
 * workspace's GitHub remotes (remotesOf, which keeps only github.com URLs). A remote neither
 * names has no page, and the reason says so.
 */
export function branchLinkOf(
  ref: ProposalBranchRef,
  origins: ReadonlyArray<{ name: string; repo: string }>,
  remotes: ReadonlyArray<{ name: string; repo: string }>,
): { url: string; unresolved: null } | { url: null; unresolved: string } {
  // The repository the branch was registered against wins (the patch view reads that one too);
  // the origins setting only answers for a remote that registration recorded no repository for.
  const repo = isRepoRemote(ref.remote)
    ? ref.remote
    : (repoOfRemote(ref.remote, remotes) ??
      origins.find((o) => o.name === ref.remote)?.repo ??
      null);
  if (repo === null) {
    return {
      url: null,
      unresolved: `Remote ${ref.remote} names no GitHub repository: it is not in the origins setting, and not a GitHub remote of the shared workspace.`,
    };
  }
  return { url: `https://github.com/${repo}/tree/${pathOf(ref.branch)}`, unresolved: null };
}

/** A declared side resolved; throws 400 `impl_remote_unknown` when the remote names no GitHub repository. */
export function resolveRef(
  ref: ProposalBranchRef,
  remotes: ReadonlyArray<{ name: string; repo: string }>,
  what: string,
): ProposalResolvedBranch {
  const repo = repoOfRemote(ref.remote, remotes);
  if (repo === null) {
    const known = remotes.map((r) => r.name);
    throw new ImplBranchError(
      400,
      "impl_remote_unknown",
      `${what} remote ${ref.remote} is not a GitHub remote of the proposal's repository (${
        known.length === 0 ? "it has none" : `its GitHub remotes: ${known.join(", ")}`
      }); name one of them, or write the repository out as owner/repo.`,
    );
  }
  return { remote: ref.remote, repo, branch: ref.branch };
}

/** A remote of `remotes` that points at `repo`, else `repo` itself: how a PR's side is declared. */
export function remoteFor(
  repo: string,
  remotes: ReadonlyArray<{ name: string; repo: string }>,
  prefer?: string,
): string {
  const lower = repo.toLowerCase();
  const matching = remotes.filter((r) => r.repo.toLowerCase() === lower);
  return (matching.find((r) => r.name === prefer) ?? matching[0])?.name ?? repo;
}

/** A PR's two sides, as GitHub reports them now. */
export interface PullBranches {
  head: { repo: string; branch: string; sha: string };
  base: { repo: string; branch: string };
  /** Whether it is merged, as GitHub answered; absent when the answer did not say. */
  merged?: boolean;
}

const PULL_BRANCHES_JQ =
  "{head_repo: .head.repo.full_name, head: .head.ref, sha: .head.sha, base_repo: .base.repo.full_name, base: .base.ref, merged: .merged}";

/** Reads a PR's head and base; throws 400 for a URL that is not a GitHub PR, 502 when GitHub does not answer. */
export async function readPullBranches(gh: RunGh, url: string): Promise<PullBranches> {
  const ref = parsePullUrl(url);
  if (ref === null || !GITHUB_NAME.test(ref.owner) || !GITHUB_NAME.test(ref.repo)) {
    throw new ImplBranchError(400, "bad_request", `Not a GitHub pull request URL: ${url}`);
  }
  const label = `${ref.owner}/${ref.repo}#${ref.number}`;
  let body: {
    head_repo?: unknown;
    head?: unknown;
    sha?: unknown;
    base_repo?: unknown;
    base?: unknown;
    merged?: unknown;
  };
  try {
    body = JSON.parse(
      await gh(
        ["api", `repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`, "--jq", PULL_BRANCHES_JQ],
        { timeoutMs: GH_TIMEOUT_MS, maxBytes: MAX_SMALL_BYTES },
      ),
    ) as typeof body;
  } catch (err) {
    throw new ImplBranchError(
      502,
      "pr_unreadable",
      `${label} could not be read from GitHub: ${reason(err)}`,
    );
  }
  const { head_repo, head, sha, base_repo, base, merged } = body;
  if (
    typeof head_repo !== "string" ||
    typeof head !== "string" ||
    typeof sha !== "string" ||
    typeof base_repo !== "string" ||
    typeof base !== "string"
  ) {
    throw new ImplBranchError(
      502,
      "pr_unreadable",
      `GitHub did not name both sides of ${label} (its head repository may be deleted).`,
    );
  }
  return {
    head: { repo: head_repo, branch: head, sha: sha.toLowerCase() },
    base: { repo: base_repo, branch: base },
    ...(typeof merged === "boolean" ? { merged } : {}),
  };
}

/** A branch's tip on GitHub, full sha; throws 502 when GitHub does not answer. */
export async function branchTip(gh: RunGh, repo: string, branch: string): Promise<string> {
  let sha: unknown;
  try {
    sha = JSON.parse(
      await gh(
        ["api", `repos/${repo}/branches/${pathOf(branch)}`, "--jq", ".commit.sha | tojson"],
        {
          timeoutMs: GH_TIMEOUT_MS,
          maxBytes: MAX_SMALL_BYTES,
        },
      ),
    );
  } catch (err) {
    throw new ImplBranchError(
      502,
      "branch_unreadable",
      `${repo}:${branch} could not be read from GitHub: ${reason(err)}`,
    );
  }
  if (typeof sha !== "string" || !SHA.test(sha.toLowerCase())) {
    throw new ImplBranchError(
      502,
      "branch_unreadable",
      `GitHub gave no tip commit for ${repo}:${branch}.`,
    );
  }
  return sha.toLowerCase();
}

/** The head side as `compare/<base>...<head>` takes it: the bare branch on the base repository, `owner:branch` on a fork. */
function headSpec(base: ProposalResolvedBranch, head: ProposalResolvedBranch): string {
  return head.repo.toLowerCase() === base.repo.toLowerCase()
    ? pathOf(head.branch)
    : `${head.repo.split("/")[0]!}:${pathOf(head.branch)}`;
}

/** The comparison's page on GitHub: `compare/<base>...<head>` on the base repository. */
export function compareUrlOf(base: ProposalResolvedBranch, head: ProposalResolvedBranch): string {
  return `https://github.com/${base.repo}/compare/${pathOf(base.branch)}...${headSpec(base, head)}`;
}

function pathOf(branch: string): string {
  return branch.split("/").map(encodeURIComponent).join("/");
}

const COMPARE_JQ =
  "{merge_base: .merge_base_commit.sha, ahead: .ahead_by, behind: .behind_by, url: .html_url, files: [(.files // [])[] | {filename, status, additions, deletions, patch, previous_filename}]}";

/**
 * The patch of `head` against `base`: the merge base of the two up to the head, with the
 * head's tip read alongside. Throws 502 when GitHub does not answer either.
 */
export async function compareBranches(
  gh: RunGh,
  base: ProposalResolvedBranch,
  head: ProposalResolvedBranch,
  pr: string | null,
): Promise<ProposalImplDiff> {
  const [headSha, body] = await Promise.all([
    branchTip(gh, head.repo, head.branch),
    (async () => {
      try {
        return JSON.parse(
          await gh(
            [
              "api",
              `repos/${base.repo}/compare/${pathOf(base.branch)}...${headSpec(base, head)}`,
              "--jq",
              COMPARE_JQ,
            ],
            { timeoutMs: GH_TIMEOUT_MS, maxBytes: MAX_COMPARE_BYTES },
          ),
        ) as {
          merge_base?: unknown;
          ahead?: unknown;
          behind?: unknown;
          url?: unknown;
          files?: Array<Record<string, unknown>>;
        };
      } catch (err) {
        throw new ImplBranchError(
          502,
          "compare_unreadable",
          `${base.repo}: ${base.branch}...${head.repo}:${head.branch} could not be compared on GitHub: ${reason(err)}`,
        );
      }
    })(),
  ]);
  const files: ProposalImplDiffFile[] = (body.files ?? []).map((f) => ({
    path: String(f.filename ?? ""),
    status: String(f.status ?? "modified"),
    from: typeof f.previous_filename === "string" ? f.previous_filename : null,
    additions: typeof f.additions === "number" ? f.additions : 0,
    deletions: typeof f.deletions === "number" ? f.deletions : 0,
    patch: typeof f.patch === "string" ? f.patch : null,
  }));
  return {
    head,
    base,
    headSha,
    mergeBase: typeof body.merge_base === "string" ? body.merge_base : null,
    ahead: typeof body.ahead === "number" ? body.ahead : 0,
    behind: typeof body.behind === "number" ? body.behind : 0,
    files,
    truncated: files.length >= COMPARE_FILE_LIMIT,
    compareUrl: typeof body.url === "string" ? body.url : compareUrlOf(base, head),
    pr,
  };
}

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
