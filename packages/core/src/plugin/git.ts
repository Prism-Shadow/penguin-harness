/**
 * The bare Git repository vocabulary a Git engine plugin compiles against: types only.
 *
 * A GitEngine opens a bare repository (`GitRepo`) whose operations run asynchronously off the
 * main thread and operate directly on the filesystem for bulk reads and writes — zero file body
 * bytes cross the JS heap for disk-backed commits and tree extractions.
 *
 * Every engine writes the exact same bytes (raw file bytes, verbatim commit message, explicit
 * `100644`/`100755` modes, standard tree sorting, empty-subtree pruning, no host `.gitconfig`
 * leakage), so the same input produces the same commit id under any engine and a repository can
 * change hands between engines at any commit.
 */

/** Relative '/'-separated path inside a subtree (no leading/trailing '/', no '.', '..', or '\'). */
export type GitRelPath = string;

/** Full lowercase hex Git object id (40 hex for SHA-1; 64 hex reserved for SHA-256). */
export type GitOid = string;

export type GitFileMode = "100644" | "100755";

/** A Git signature identity; callers guarantee no '<', '>', '\r', or '\n'. */
export interface GitIdentity {
  name: string;
  email: string;
}

export interface GitTimestamp {
  /** Whole Unix seconds since the epoch. */
  seconds: number;
  /** Timezone offset in minutes east of UTC (e.g. +480 for +0800, -300 for -0500). */
  offset: number;
}

/** Source of a file's bytes for a commit: direct filesystem path for bulk/large files, bytes for tests or tiny generated files. */
export type GitFileSource = { kind: "file"; path: string } | { kind: "bytes"; body: Uint8Array };

export interface GitCommitFile {
  rel: GitRelPath;
  source: GitFileSource;
  /** Defaults to "100644". */
  mode?: GitFileMode;
}

export type GitTreeChange =
  | {
      /** Replaces everything under `prefix`; `files: null` removes the entire subtree at `prefix`. */
      kind: "replace";
      files: readonly GitCommitFile[] | null;
    }
  | {
      /** Incrementally updates/removes entries under `prefix` on top of `parent`'s tree. */
      kind: "patch";
      upsert: readonly GitCommitFile[];
      remove: readonly GitRelPath[];
    };

export interface GitCommitInput {
  /** Full ref name to advance, e.g. "refs/heads/main". */
  ref: string;
  /** Expected current tip for atomic CAS; null for a branch's first commit (ref must not exist). */
  parent: GitOid | null;
  /** Target subtree prefix: "" for the root tree, "workbenches/demo" for a subfolder. */
  prefix: string;
  change: GitTreeChange;
  /** Whole commit message, already normalized by the caller; written verbatim by the engine. */
  message: string;
  author: GitIdentity;
  committer: GitIdentity;
  when: GitTimestamp;
  /**
   * Optional atomicity gate invoked after all objects (blobs, trees, commit) are written to the
   * ODB and before the branch ref is moved via CAS. Throwing aborts the commit without moving `ref`.
   */
  beforeMoveRef?: (prepared: { commit: GitOid; tree: GitOid }) => Promise<void>;
}

export interface GitTreeEntry {
  rel: GitRelPath;
  /** Git blob OID (content hash), returned directly from the tree object at zero extra cost. */
  oid: GitOid;
  mode: GitFileMode;
  /** Populated only when `listTree` is called with `{ withSize: true }`. */
  size?: number;
}

export interface GitWalkHistoryOptions {
  fromCommit: GitOid;
  /** Subtree prefix, or "" for the root tree. */
  prefix: string;
  /** Maximum number of version entries to return. */
  limit: number;
  /** Maximum number of first-parent commits to walk. */
  maxWalk: number;
}

export interface GitHistoryEntry {
  commit: GitOid;
  /** Subtree OID at `prefix` for this commit. */
  tree: GitOid;
  /** Committer Unix timestamp in whole seconds. */
  committerTime: number;
}

export interface GitExtractTreeOptions {
  commitOid: GitOid;
  /** Subtree prefix: "" for the root tree, "workbenches/demo" for a folder, etc. */
  prefix: string;
  /** Destination empty directory (absolute). Created if absent; rejected with DEST_NOT_EMPTY if non-empty. */
  destDir: string;
  /** Optional relative paths under `prefix` to extract (subset preview / partial restore). */
  onlyPaths?: readonly GitRelPath[];
}

export interface GitExtractTreeResult {
  files: GitRelPath[];
  totalBytes: number;
}

export type GitErrorCode =
  | "CAS_CONFLICT"
  | "PARENT_NOT_FOUND"
  | "INVALID_REF"
  | "INVALID_OID"
  | "INVALID_PATH"
  | "DEST_NOT_EMPTY"
  | "SOURCE_CHANGED"
  | "REPO_CORRUPT"
  | "IO_ERROR";

export interface GitError extends Error {
  readonly code: GitErrorCode;
}

/** An asynchronous handle to a single bare Git repository. */
export interface GitRepo {
  /** Resolves symbolic HEAD and its target commit (null before first commit; throws INVALID_REF on detached/corrupt HEAD or ref). */
  resolveHead(): Promise<{ ref: string; commit: GitOid | null }>;

  /** Lists all blob entries under `prefix` at `commitOid` (null when `prefix` or `commitOid` is absent; submodules skipped). */
  listTree(
    commitOid: GitOid,
    prefix: string,
    opts?: { withSize?: boolean },
  ): Promise<GitTreeEntry[] | null>;

  /**
   * Walks first-parent history from `fromCommit`, recording up to `limit` commits within `maxWalk`
   * steps where `prefix`'s subtree changed. Stops at the first ancestor where `prefix` is absent.
   * When `prefix` exists at `fromCommit` and remained unchanged across all `maxWalk` inspected
   * commits, returns a single representative entry for the oldest inspected commit.
   */
  walkHistory(opts: GitWalkHistoryOptions): Promise<GitHistoryEntry[]>;

  /** Extracts `prefix` (or `onlyPaths` subset) from `commitOid` directly onto the filesystem at empty `destDir`. */
  extractTree(opts: GitExtractTreeOptions): Promise<GitExtractTreeResult>;

  /** Writes objects and atomically advances `ref` from `parent` via CAS; resolves to the new commit OID. */
  commit(input: GitCommitInput): Promise<GitOid>;

  /** Releases underlying handles or background helper processes. */
  close(): Promise<void>;
}

/** A pluggable bare Git repository engine. */
export interface GitEngine {
  readonly name: string;
  /** Opens an existing bare repository at `gitdir` (absolute path). */
  open(gitdir: string): Promise<GitRepo>;
}

export interface GitEngineHost {
  cacheDir: string;
  log(line: string): void;
}

export type GitEngineSource = (host: GitEngineHost) => GitEngine | Promise<GitEngine>;
