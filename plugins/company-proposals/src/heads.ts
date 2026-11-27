/**
 * The commit of a subject, as a run that needs one resolves it when it starts (a deploy): a
 * proposal's impl — its declared head branch's tip, else its impl PR's head — a change request's
 * head, or a branch's tip. Read from the forge now, never from a cache: what runs must be the
 * commit the caller looked at, and the registry holds it to `expectedHead`.
 */
import type { SubjectCommit } from "./action-model.js";
import { GITHUB_NAME, ghRunner, parsePullUrl, type RunGh } from "./pr-status.js";
import { ImplBranchError, branchTip } from "./impl-branch.js";
import { ProposalError } from "./domain.js";

/** A proposal's impl as a head reads it: its declared head (resolved to a repository), and its PR. */
export interface HeadImpl {
  /** null when the impl was registered as a PR alone: the PR's head is used. */
  head: { repo: string; branch: string } | null;
  pr: string | null;
}

/** What resolving a head needs of the organization (ProposalService.subjects). */
export interface HeadScope {
  /** A proposal's impl, null when it has none; throws 404 for a proposal that does not exist. */
  impl(number: number): Promise<HeadImpl | null>;
  /** The shared workspace's GitHub remotes. */
  remotes(): Promise<Array<{ name: string; repo: string }>>;
  /** The PR graph's repository (`owner/repo`), null when none is configured or found. */
  deliveryRepo(): Promise<string | null>;
}

const notConfigured = (): ProposalError =>
  new ProposalError(
    409,
    "graph_not_configured",
    "No delivery repository: none is set under Settings → Plugins → Company proposals and the shared workspace has no GitHub remote.",
  );

/** A proposal's head: its declared head branch's tip, else its impl PR's head. */
export async function proposalHead(
  scope: HeadScope,
  number: number,
  gh: RunGh = ghRunner(),
): Promise<SubjectCommit> {
  const impl = await scope.impl(number);
  if (impl === null) {
    throw new ProposalError(
      409,
      "no_impl",
      `Proposal #${number} has no impl: register its branch or its PR with \`penguin org proposal impl\` first.`,
    );
  }
  const head =
    impl.head !== null ? await branchHead(gh, impl.head, impl.pr) : await pullHead(gh, impl.pr!);
  return { ...head, proposal: number };
}

/** A change request's head: `owner/repo#n`, or `n` of the delivery repository. */
export async function changeRequestHead(
  scope: HeadScope,
  id: string,
  gh: RunGh = ghRunner(),
): Promise<SubjectCommit> {
  const m = /^(?:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+))?#?(\d+)$/.exec(id);
  if (m === null) throw new ProposalError(400, "bad_subject", `Not a change request: ${id}`);
  const repo = m[1] ?? (await scope.deliveryRepo());
  if (repo === null) throw notConfigured();
  return { ...(await pullHead(gh, `https://github.com/${repo}/pull/${m[2]}`)), proposal: null };
}

/** A branch's tip: `remote/branch`, the remote one of the shared workspace's or `owner/repo`. */
export async function branchCommit(
  scope: HeadScope,
  id: string,
  gh: RunGh = ghRunner(),
): Promise<SubjectCommit> {
  const remotes = await scope.remotes();
  const named = remotes.find((r) => id.startsWith(`${r.name}/`));
  let repo: string;
  let branch: string;
  if (named !== undefined) {
    repo = named.repo;
    branch = id.slice(named.name.length + 1);
  } else {
    const m = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/(.+)$/.exec(id);
    if (m === null) {
      throw new ProposalError(
        400,
        "bad_subject",
        `${id}: name the branch as <remote>/<branch> (a remote of the shared workspace) or <owner>/<repo>/<branch>.`,
      );
    }
    repo = m[1]!;
    branch = m[2]!;
  }
  return { ...(await branchHead(gh, { repo, branch }, null)), proposal: null };
}

type Head = Omit<SubjectCommit, "proposal">;

async function pullHead(gh: RunGh, url: string): Promise<Head> {
  const ref = parsePullUrl(url);
  if (ref === null || !GITHUB_NAME.test(ref.owner) || !GITHUB_NAME.test(ref.repo)) {
    throw new ProposalError(409, "not_a_github_pr", `Not a GitHub pull request: ${url}`);
  }
  let body: { head?: { sha?: unknown; ref?: unknown }; html_url?: unknown };
  try {
    body = JSON.parse(
      await gh(["api", `repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`], {
        timeoutMs: 15_000,
        maxBytes: 1024 * 1024,
      }),
    ) as typeof body;
  } catch (err) {
    throw new ProposalError(
      502,
      "pr_unreadable",
      `${ref.owner}/${ref.repo}#${ref.number} could not be read from GitHub: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const sha = body.head?.sha;
  if (typeof sha !== "string" || !/^[0-9a-f]{40}$/.test(sha)) {
    throw new ProposalError(
      502,
      "pr_unreadable",
      `GitHub gave no head commit for ${ref.owner}/${ref.repo}#${ref.number}.`,
    );
  }
  return {
    repo: `${ref.owner}/${ref.repo}`,
    pr: ref.number,
    prUrl: typeof body.html_url === "string" ? body.html_url : url,
    branch: typeof body.head?.ref === "string" ? body.head.ref : "",
    sha,
  };
}

async function branchHead(
  gh: RunGh,
  head: { repo: string; branch: string },
  pr: string | null,
): Promise<Head> {
  let sha: string;
  try {
    sha = await branchTip(gh, head.repo, head.branch);
  } catch (err) {
    if (err instanceof ImplBranchError) throw new ProposalError(err.status, err.code, err.message);
    throw err;
  }
  const ref = pr === null ? null : parsePullUrl(pr);
  return {
    repo: head.repo,
    pr: ref?.number ?? null,
    prUrl: ref === null ? null : pr,
    branch: head.branch,
    sha,
  };
}
