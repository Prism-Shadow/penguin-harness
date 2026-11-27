/**
 * An impl branch's diff, file by file with hunks: the merge base of base and head, up to head —
 * the same patch GitHub's `compare/<base>...<head>` shows, so commits the base gained after the
 * head branched off never count.
 *
 * Read from the delivery repository's blobless mirror (git-mirror.ts) when it can answer. The
 * mirror holds commits and trees only, so the diff first names the blobs of the changed paths
 * from the trees, then fetches the ones the mirror lacks by id in one explicit fetch — from the
 * head's repository, which holds both sides — and only then reads counts and patch text. Lazy
 * fetch stays off for every git command: a blob the explicit fetch did not bring makes the
 * command fail rather than quietly reach the network, and the diff falls back. The fetch is
 * bounded by a blob count and the fetch's deadline; what it brings stays in the mirror as a
 * promisor pack, so the mirror is still the partial clone it was, with no ref written.
 *
 * Caps: a file whose content on either side is over FILE_BYTES keeps its counts and loses its
 * hunks (`tooLarge`); the patch text is read up to DIFF_BYTES, and every file it did not reach
 * keeps its counts only (`diffLimit`). `ignoreWhitespace` is git's `-w`.
 *
 * When the mirror cannot answer — not built yet, a commit or blob that cannot be fetched, more
 * files than the blob cap — the diff is parsed from GitHub's comparison instead (its per-file
 * patches), marked `source: "github"` with the reason: GitHub lists at most 300 files, leaves the
 * patch out of a binary or large file without saying which, and cannot ignore whitespace.
 *
 * A mirror answer is cached by (head commit, base commit, ignoreWhitespace): a branch that moves
 * is a new key. Read-only: nothing here writes the proposal or any ref.
 */
import type {
  ProposalImplChangedFile,
  ProposalImplChanges,
  ProposalImplDiff,
  ProposalResolvedBranch,
} from "@prismshadow/penguin-server/api";
import { branchTip, compareBranches, compareUrlOf } from "./impl-branch.js";
import type { DiffMirror, MirrorDiffEntry } from "./ports.js";
import type { RunGh } from "./pr-status.js";
import { gitHeader, parseHunks, splitPatch } from "./unified-patch.js";

/** One file's content cap, either side: past it the file keeps its counts only. */
export const FILE_BYTES = 512 * 1024;
/** The whole diff's patch text: files past it keep their counts only. */
export const DIFF_BYTES = 4 * 1024 * 1024;
/** The blobs one diff may fetch; a larger diff is GitHub's to answer. */
export const MAX_BLOBS = 4000;
/** Too-large files are left out of the patch by pathspec; past this many the patch is not read. */
const MAX_EXCLUDES = 200;
/** Mirror answers kept. */
const CACHE_SIZE = 32;

export interface ImplChangesRequest {
  head: ProposalResolvedBranch;
  base: ProposalResolvedBranch;
  pr: string | null;
  ignoreWhitespace: boolean;
}

export interface ImplChangesDeps {
  gh: RunGh;
  /** The base repository's mirror; null when there is none to ask. */
  mirror: DiffMirror | null;
  cache: ImplChangesCache;
  /** GitHub's comparison; compareBranches unless a test stands in. */
  compare?: (
    base: ProposalResolvedBranch,
    head: ProposalResolvedBranch,
    pr: string | null,
  ) => Promise<ProposalImplDiff>;
  log?: (line: string) => void;
  /** The caps; FILE_BYTES and DIFF_BYTES unless a test makes them small. */
  limits?: { fileBytes: number; diffBytes: number };
}

/** Answers in flight and answered, by key; a GitHub answer or a failure is not kept. */
export class ImplChangesCache {
  private readonly entries = new Map<string, Promise<ProposalImplChanges>>();

  run(key: string, compute: () => Promise<ProposalImplChanges>): Promise<ProposalImplChanges> {
    const hit = this.entries.get(key);
    if (hit !== undefined) {
      // Most recently used last.
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit;
    }
    const pending = compute();
    this.entries.set(key, pending);
    while (this.entries.size > CACHE_SIZE) this.entries.delete(this.entries.keys().next().value!);
    pending.then(
      (r) => {
        if (r.source !== "mirror" && this.entries.get(key) === pending) this.entries.delete(key);
      },
      () => {
        if (this.entries.get(key) === pending) this.entries.delete(key);
      },
    );
    return pending;
  }
}

/** Why the mirror did not answer: the diff falls back to GitHub with this as the reason. */
class MirrorUnavailable extends Error {}

export async function implChanges(
  deps: ImplChangesDeps,
  req: ImplChangesRequest,
): Promise<ProposalImplChanges> {
  const [headSha, baseSha] = await Promise.all([
    branchTip(deps.gh, req.head.repo, req.head.branch),
    branchTip(deps.gh, req.base.repo, req.base.branch),
  ]);
  const key = `${req.base.repo.toLowerCase()}|${headSha}|${baseSha}|${req.ignoreWhitespace ? 1 : 0}`;
  const limits = deps.limits ?? { fileBytes: FILE_BYTES, diffBytes: DIFF_BYTES };
  return deps.cache.run(key, async () => {
    try {
      if (deps.mirror === null) throw new MirrorUnavailable("there is no mirror to read");
      return await fromMirror(deps.mirror, req, headSha, baseSha, limits);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      deps.log?.(
        `[company-proposals] impl diff ${req.base.repo}:${req.base.branch}...${req.head.repo}:${req.head.branch} from GitHub: ${reason}`,
      );
      const compare =
        deps.compare ??
        ((b: ProposalResolvedBranch, h: ProposalResolvedBranch, pr: string | null) =>
          compareBranches(deps.gh, b, h, pr));
      return fromGithub(await compare(req.base, req.head, req.pr), baseSha, reason, limits);
    }
  });
}

async function fromMirror(
  mirror: DiffMirror,
  req: ImplChangesRequest,
  headSha: string,
  baseSha: string,
  limits: { fileBytes: number; diffBytes: number },
): Promise<ProposalImplChanges> {
  if (!mirror.exists()) {
    throw new MirrorUnavailable(`the mirror of ${req.base.repo} is not built yet`);
  }
  const elsewhere = (side: ProposalResolvedBranch) =>
    side.repo.toLowerCase() === req.base.repo.toLowerCase() ? {} : { from: side.repo };
  for (const [sha, side] of [
    [headSha, req.head],
    [baseSha, req.base],
  ] as const) {
    if ((await mirror.missing([sha])).length === 0) continue;
    // The branch, under the name a graph refresh gives it (a fetch with negotiation: only the
    // commits the mirror lacks), never a ref of the diff's own.
    await mirror.fetch([`refs/heads/${side.branch}`], elsewhere(side));
    if ((await mirror.missing([sha])).length > 0) {
      throw new MirrorUnavailable(`${side.repo}:${side.branch} moved while it was read`);
    }
  }
  const mergeBase = await mirror.mergeBase(baseSha, headSha);
  if (mergeBase === null) throw new MirrorUnavailable("base and head share no commit");

  const blobs = await mirror.changedBlobs(mergeBase, headSha);
  if (blobs.length > MAX_BLOBS) {
    throw new MirrorUnavailable(`the diff reads ${blobs.length} blobs, over ${MAX_BLOBS}`);
  }
  let sizes = await mirror.objectSizes(blobs);
  const lacking = blobs.filter((oid) => sizes.get(oid) == null);
  if (lacking.length > 0) {
    // The head's repository has the merge base's blobs too: it is an ancestor of the head.
    await mirror.fetchObjects(lacking, elsewhere(req.head));
    sizes = await mirror.objectSizes(blobs);
    const still = blobs.filter((oid) => sizes.get(oid) == null).length;
    if (still > 0) throw new MirrorUnavailable(`${still} blobs could not be fetched`);
  }

  let entries = await mirror.diffStat(mergeBase, headSha, {
    ignoreWhitespace: req.ignoreWhitespace,
  });
  if (req.ignoreWhitespace) {
    // A change of whitespace alone leaves nothing to show.
    entries = entries.filter(
      (e) => e.status !== "modified" || e.binary || e.additions + e.deletions > 0,
    );
  }
  const sizeOf = (oid: string | null) => (oid === null ? 0 : (sizes.get(oid) ?? 0));
  const tooLarge = new Set(
    entries.filter(
      (e) => !e.binary && Math.max(sizeOf(e.oldOid), sizeOf(e.newOid)) > limits.fileBytes,
    ),
  );
  const exclude = [...tooLarge].flatMap((e) =>
    e.oldPath === null ? [e.path] : [e.oldPath, e.path],
  );
  const patch =
    exclude.length > MAX_EXCLUDES
      ? { text: "", cut: true }
      : await mirror.patch(mergeBase, headSha, {
          ignoreWhitespace: req.ignoreWhitespace,
          exclude,
          maxBytes: limits.diffBytes,
        });
  const sections = splitPatch(patch.text);
  // The section the cap stopped in is incomplete: its file keeps its counts only.
  if (patch.cut) sections.pop();
  const bodies = new Map(sections.map((s) => [s.header, s.body]));

  const files = entries.map((e): ProposalImplChangedFile => {
    const file = fileOf(e);
    if (e.binary) return file;
    if (tooLarge.has(e)) return { ...file, omitted: "tooLarge" };
    const body = bodies.get(gitHeader(e.oldPath ?? e.path, e.path));
    if (body === undefined) return patch.cut ? { ...file, omitted: "diffLimit" } : file;
    return { ...file, hunks: parseHunks(body) };
  });
  return {
    head: req.head,
    base: req.base,
    headSha,
    baseSha,
    mergeBase,
    source: "mirror",
    fallbackReason: null,
    ignoreWhitespace: req.ignoreWhitespace,
    files,
    ...totals(files),
    truncated: false,
    limits,
    compareUrl: compareUrlOf(req.base, req.head),
  };
}

function fileOf(e: MirrorDiffEntry): ProposalImplChangedFile {
  return {
    path: e.path,
    oldPath: e.oldPath,
    status: e.status,
    additions: e.additions,
    deletions: e.deletions,
    binary: e.binary,
    omitted: null,
    hunks: [],
  };
}

/** GitHub's comparison as the structured diff: its per-file patches parsed into hunks. */
export function fromGithub(
  diff: ProposalImplDiff,
  baseSha: string,
  reason: string,
  limits: { fileBytes: number; diffBytes: number },
): ProposalImplChanges {
  const files = diff.files.map((f): ProposalImplChangedFile => {
    const status = githubStatus(f.status);
    const file: ProposalImplChangedFile = {
      path: f.path,
      oldPath: status === "renamed" ? f.from : null,
      status,
      additions: f.additions,
      deletions: f.deletions,
      binary: false,
      omitted: null,
      hunks: [],
    };
    if (f.patch !== null) return { ...file, hunks: parseHunks(f.patch) };
    // A pure rename has nothing to show; any other file without a patch is binary or too large.
    return status === "renamed" && f.additions + f.deletions === 0
      ? file
      : { ...file, omitted: "noPatch" };
  });
  return {
    head: diff.head,
    base: diff.base,
    headSha: diff.headSha,
    baseSha,
    mergeBase: diff.mergeBase,
    source: "github",
    fallbackReason: reason,
    ignoreWhitespace: false,
    files,
    ...totals(files),
    truncated: diff.truncated,
    limits,
    compareUrl: diff.compareUrl,
  };
}

function githubStatus(status: string): ProposalImplChangedFile["status"] {
  if (status === "added" || status === "copied") return "added";
  if (status === "removed") return "deleted";
  if (status === "renamed") return "renamed";
  return "modified";
}

function totals(files: ProposalImplChangedFile[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const f of files) {
    additions += f.additions;
    deletions += f.deletions;
  }
  return { additions, deletions };
}
