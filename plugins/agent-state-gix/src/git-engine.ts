/**
 * Unified `GitEngine` / `GitRepo` backed by in-process Rust `gitoxide` (`NativeRepo`).
 *
 * Lifecycle & concurrency:
 * - Every public `GitRepo` call passes through an admission gate (`inFlight` counter).
 * - `close()` is idempotent, immediately rejects new calls, drains every in-flight operation
 *   (including commits awaiting `beforeMoveRef` and completing `casRef`), and only then releases
 *   the native `Arc<ThreadSafeRepository>`.
 * - Calling `close()` from inside `beforeMoveRef` on the same repo is detected via
 *   `AsyncLocalStorage` and rejected cleanly instead of deadlocking.
 * - Heavy bulk operations (`prepareCommit`, `extractTree`) pass through a bounded concurrency
 *   semaphore so they cannot starve unrelated Node libuv filesystem work.
 */
import { AsyncLocalStorage } from "node:async_hooks";
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

/** Cap concurrent heavy libuv tasks so gitoxide never starves unrelated Node fs I/O. */
const MAX_CONCURRENT_BULK = 2;
let activeBulk = 0;
const bulkWaiters: Array<() => void> = [];

async function withBulkSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeBulk >= MAX_CONCURRENT_BULK) {
    await new Promise<void>((resolve) => bulkWaiters.push(resolve));
  } else {
    activeBulk += 1;
  }
  try {
    return await fn();
  } finally {
    const next = bulkWaiters.shift();
    if (next) {
      // Direct permit transfer: `activeBulk` remains accounted for the woken waiter (Minor #2).
      next();
    } else {
      activeBulk -= 1;
    }
  }
}

function gitError(code: GitErrorCode, message: string): GitError {
  return Object.assign(new Error(message), { code });
}

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

function assertNotSharedBuffer(body: Uint8Array, label: string): Buffer {
  if (typeof SharedArrayBuffer !== "undefined" && body.buffer instanceof SharedArrayBuffer) {
    throw gitError("INVALID_PATH", `${label}: SharedArrayBuffer-backed buffers are not supported`);
  }
  return Buffer.isBuffer(body) ? body : Buffer.from(body.buffer, body.byteOffset, body.byteLength);
}

function toNativeFile(f: GitCommitFile): NativeRepoCommitFileInput {
  if (f.source.kind === "file") {
    return { rel: f.rel, filePath: f.source.path, mode: f.mode ?? "100644" };
  }
  return {
    rel: f.rel,
    body: assertNotSharedBuffer(f.source.body, f.rel),
    mode: f.mode ?? "100644",
  };
}

function wrapRepo(handle: NativeRepo): GitRepo {
  const hookScope = new AsyncLocalStorage<symbol>();
  const activeHooks = new Set<symbol>();
  let closing = false;
  let closed = false;
  let inFlight = 0;
  let closePromise: Promise<void> | null = null;
  const drainWaiters: Array<() => void> = [];

  const notifyDrained = () => {
    if (inFlight === 0 && drainWaiters.length > 0) {
      const list = drainWaiters.splice(0);
      for (const resolve of list) resolve();
    }
  };

  async function runAdmitted<T>(fn: () => Promise<T>): Promise<T> {
    if (closed || closing) {
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
          const rows = await handle.listTree(commitOid, prefix, opts?.withSize ?? false);
          if (rows === null || rows === undefined) return null;
          return rows.map((row) => ({
            rel: row.rel,
            oid: row.oid,
            mode: row.mode as GitFileMode,
            ...(row.size !== undefined && row.size !== null ? { size: row.size } : {}),
          }));
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
          return rows.map((row) => ({
            commit: row.commit,
            tree: row.tree,
            committerTime: row.committerTime,
          }));
        } catch (err) {
          wrapGitError(err);
        }
      });
    },

    extractTree(opts: GitExtractTreeOptions): Promise<GitExtractTreeResult> {
      return runAdmitted(() =>
        withBulkSlot(async () => {
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
        }),
      );
    },

    commit(input: GitCommitInput): Promise<string> {
      return runAdmitted(async () => {
        // Snapshot mutable inputs upfront so a beforeMoveRef hook cannot mutate CAS operands.
        const refName = String(input.ref);
        const expectedParent = input.parent === null ? null : String(input.parent);
        const prefix = String(input.prefix);
        const message = String(input.message);
        const author = {
          name: String(input.author.name),
          email: String(input.author.email),
          whenSeconds: input.when.seconds,
          whenOffsetMinutes: input.when.offset,
        };
        const committer = {
          name: String(input.committer.name),
          email: String(input.committer.email),
          whenSeconds: input.when.seconds,
          whenOffsetMinutes: input.when.offset,
        };
        const change = input.change;
        const changeKind = change.kind;
        const files =
          change.kind === "replace"
            ? change.files === null
              ? undefined
              : change.files.map(toNativeFile)
            : change.upsert.map(toNativeFile);
        const remove = change.kind === "patch" ? [...change.remove] : undefined;
        const beforeMoveRef = input.beforeMoveRef;

        let preparedCommit: string;
        let preparedTree: string;
        try {
          const prepared = await withBulkSlot(() =>
            handle.prepareCommit({
              parent: expectedParent ?? undefined,
              prefix,
              changeKind,
              files,
              remove,
              message,
              author,
              committer,
            }),
          );
          preparedCommit = String(prepared.commit);
          preparedTree = String(prepared.tree);
        } catch (err) {
          wrapGitError(err);
        }

        if (beforeMoveRef !== undefined) {
          // Guard re-entrant close() ONLY while this specific hook invocation is active (Minor #3).
          const frozenSnapshot = Object.freeze({ commit: preparedCommit, tree: preparedTree });
          const token = Symbol("beforeMoveRef");
          activeHooks.add(token);
          try {
            await hookScope.run(token, () => beforeMoveRef(frozenSnapshot));
          } finally {
            activeHooks.delete(token);
          }
        }

        try {
          await handle.casRef(refName, preparedCommit, expectedParent ?? undefined);
          return preparedCommit;
        } catch (err) {
          wrapGitError(err);
        }
      });
    },

    close(): Promise<void> {
      const activeHook = hookScope.getStore();
      if (activeHook !== undefined && activeHooks.has(activeHook)) {
        return Promise.reject(
          gitError("IO_ERROR", "cannot close GitRepo from inside beforeMoveRef hook"),
        );
      }
      if (closePromise !== null) return closePromise;
      closing = true;
      closePromise = (async () => {
        if (inFlight > 0) {
          await new Promise<void>((resolve) => drainWaiters.push(resolve));
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
    name: `${version} (gix)`,
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

export async function openGixGitEngine(host: GitEngineHost): Promise<GitEngine> {
  const say = (line: string) => host.log(`[agent-state-gix] ${line}`);
  const native = loadNative();
  const version = native.engineVersion();
  say(`using ${version} (in-process)`);
  return gixGitEngine(native, version);
}
