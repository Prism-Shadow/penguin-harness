/**
 * Unified `GitEngine` / `GitRepo` backed by in-process Rust `gitoxide` (`NativeRepo`).
 *
 * Lifecycle & concurrency:
 * - Every public `GitRepo` call passes through an admission gate (`inFlight` counter).
 * - `close()` is idempotent, rejects new calls immediately, drains in-flight operations, and
 *   only then releases the native `Arc<ThreadSafeRepository>`.
 * - Re-entrant calls made from inside `commit`'s `beforeMoveRef` hook use an internal re-entry
 *   depth counter so `close()` draining never self-deadlocks.
 */
import type {
  GitCommitFile,
  GitCommitInput,
  GitEngine,
  GitEngineHost,
  GitError,
  GitErrorCode,
  GitExtractTreeOptions,
  GitExtractTreeResult,
  GitFileMode,
  GitHistoryEntry,
  GitRepo,
  GitTreeEntry,
  GitWalkHistoryOptions,
} from "@prismshadow/penguin-core/plugin";
import {
  loadNative,
  type Native,
  type NativeRepo,
  type NativeRepoCommitFileInput,
} from "./binary.js";

const GIT_ERROR_RE = /^GIT_ERROR:([A-Z_]+):(.*)$/s;

function gitError(code: GitErrorCode, message: string): GitError {
  return Object.assign(new Error(message), { code });
}

const GIT_ERROR_CODES: ReadonlySet<string> = new Set<GitErrorCode>([
  "CAS_CONFLICT",
  "PARENT_NOT_FOUND",
  "INVALID_REF",
  "INVALID_OID",
  "INVALID_PATH",
  "DEST_NOT_EMPTY",
  "SOURCE_CHANGED",
  "REPO_CORRUPT",
  "IO_ERROR",
]);

function wrapGitError(err: unknown): never {
  if (
    err &&
    typeof err === "object" &&
    "code" in err &&
    typeof (err as GitError).code === "string" &&
    GIT_ERROR_CODES.has((err as GitError).code)
  ) {
    throw err;
  }
  const raw = err instanceof Error ? err.message : String(err);
  const match = GIT_ERROR_RE.exec(raw);
  if (match && GIT_ERROR_CODES.has(match[1]!)) {
    const code = match[1] as GitErrorCode;
    const message = match[2]!.trim();
    throw gitError(code, message);
  }
  throw gitError("IO_ERROR", raw);
}

function toNativeFile(f: GitCommitFile): NativeRepoCommitFileInput {
  if (f.source.kind === "file") {
    return { rel: f.rel, filePath: f.source.path, mode: f.mode ?? "100644" };
  }
  return { rel: f.rel, body: f.source.body, mode: f.mode ?? "100644" };
}

function wrapRepo(handle: NativeRepo): GitRepo {
  let closing = false;
  let closed = false;
  let inFlight = 0;
  let hookDepth = 0;
  let closePromise: Promise<void> | null = null;
  const drainWaiters: Array<() => void> = [];

  const notifyDrained = () => {
    if (inFlight === 0 && drainWaiters.length > 0) {
      const list = drainWaiters.splice(0);
      for (const resolve of list) resolve();
    }
  };

  async function runAdmitted<T>(fn: () => Promise<T>): Promise<T> {
    if (closed || (closing && hookDepth === 0)) {
      throw gitError("IO_ERROR", "GitRepo has been closed");
    }
    inFlight += 1;
    try {
      return await fn();
    } finally {
      inFlight -= 1;
      notifyDrained();
    }
  }

  return {
    resolveHead() {
      return runAdmitted(async () => {
        try {
          const res = await handle.resolveHead();
          return { ref: res.refName, commit: res.commit ?? null };
        } catch (err) {
          wrapGitError(err);
        }
      });
    },

    listTree(
      commitOid: string,
      prefix: string,
      opts?: { withSize?: boolean },
    ): Promise<GitTreeEntry[] | null> {
      return runAdmitted(async () => {
        try {
          const entries = await handle.listTree(commitOid, prefix, opts?.withSize === true);
          if (entries === null || entries === undefined) return null;
          return entries.map((e) => {
            const item: GitTreeEntry = {
              rel: e.rel,
              oid: e.oid,
              mode: (e.mode === "100755" ? "100755" : "100644") as GitFileMode,
            };
            if (e.size !== undefined) item.size = e.size;
            return item;
          });
        } catch (err) {
          wrapGitError(err);
        }
      });
    },

    walkHistory(opts: GitWalkHistoryOptions): Promise<GitHistoryEntry[]> {
      return runAdmitted(async () => {
        try {
          const rows = await handle.walkHistory(
            opts.fromCommit,
            opts.prefix,
            opts.limit,
            opts.maxWalk,
          );
          return rows.map((r) => ({
            commit: r.commit,
            tree: r.tree,
            committerTime: r.committerTime,
          }));
        } catch (err) {
          wrapGitError(err);
        }
      });
    },

    extractTree(opts: GitExtractTreeOptions): Promise<GitExtractTreeResult> {
      return runAdmitted(async () => {
        try {
          const res = await handle.extractTree(
            opts.commitOid,
            opts.prefix,
            opts.destDir,
            opts.onlyPaths ? [...opts.onlyPaths] : undefined,
          );
          return { files: res.files, totalBytes: res.totalBytes };
        } catch (err) {
          wrapGitError(err);
        }
      });
    },

    commit(input: GitCommitInput): Promise<string> {
      return runAdmitted(async () => {
        const identity = (who: GitCommitInput["author"]) => ({
          name: who.name,
          email: who.email,
          whenSeconds: input.when.seconds,
          whenOffsetMinutes: input.when.offset,
        });
        const nativeInput =
          input.change.kind === "replace"
            ? {
                parent: input.parent ?? undefined,
                prefix: input.prefix,
                changeKind: "replace" as const,
                files:
                  input.change.files === null ? undefined : input.change.files.map(toNativeFile),
                message: input.message,
                author: identity(input.author),
                committer: identity(input.committer),
              }
            : {
                parent: input.parent ?? undefined,
                prefix: input.prefix,
                changeKind: "patch" as const,
                files: input.change.upsert.map(toNativeFile),
                remove: [...input.change.remove],
                message: input.message,
                author: identity(input.author),
                committer: identity(input.committer),
              };

        let prepared: { commit: string; tree: string };
        try {
          prepared = await handle.prepareCommit(nativeInput);
        } catch (err) {
          wrapGitError(err);
        }
        if (input.beforeMoveRef !== undefined) {
          hookDepth += 1;
          try {
            await input.beforeMoveRef(prepared);
          } finally {
            hookDepth -= 1;
          }
        }
        try {
          await handle.casRef(input.ref, prepared.commit, input.parent ?? undefined);
        } catch (err) {
          wrapGitError(err);
        }
        return prepared.commit;
      });
    },

    close(): Promise<void> {
      if (closePromise !== null) return closePromise;
      closing = true;
      closePromise = (async () => {
        // If called re-entrantly from inside beforeMoveRef, do not self-deadlock;
        // release native handle once outer call completes (or immediately if inFlight === 0).
        if (inFlight > 0 && hookDepth === 0) {
          await new Promise<void>((resolve) => {
            if (inFlight === 0) resolve();
            else drainWaiters.push(resolve);
          });
        }
        closed = true;
        handle.close();
      })();
      return closePromise;
    },
  };
}

export function gixGitEngine(native: Native, version: string): GitEngine {
  return {
    name: `${version} (gitoxide)`,
    async open(gitdir: string): Promise<GitRepo> {
      try {
        const handle = await native.openRepo(gitdir);
        return wrapRepo(handle);
      } catch (err) {
        wrapGitError(err);
      }
    },
  };
}

let cachedNative: Native | undefined;

export function openGixGitEngine(host: GitEngineHost): GitEngine {
  const say = (line: string) => host.log(`[agent-state-gix] ${line}`);
  if (cachedNative === undefined) {
    try {
      cachedNative = loadNative();
    } catch (err) {
      throw new Error(`the native half did not load: ${(err as Error).message}`);
    }
  }
  const version = cachedNative.engineVersion();
  say(`${version} in-process`);
  return gixGitEngine(cachedNative, version);
}
