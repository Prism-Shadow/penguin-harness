/**
 * The `GitEngine` / `GitRepo` implementation on gitoxide (`NativeRepo` AsyncTask handle).
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
import { loadNative, type Native, type NativeRepo, type NativeRepoCommitFileInput } from "./binary.js";

const GIT_ERROR_RE = /^GIT_ERROR:([A-Z_]+):(.*)$/s;

function wrapGitError(err: unknown): never {
  const raw = err instanceof Error ? err.message : String(err);
  const match = GIT_ERROR_RE.exec(raw);
  if (match !== null) {
    const code = match[1] as GitErrorCode;
    const message = match[2]!.trim();
    const out: GitError = Object.assign(new Error(message), { code });
    throw out;
  }
  const out: GitError = Object.assign(new Error(raw), { code: "IO_ERROR" as const });
  throw out;
}

function toNativeFile(f: GitCommitFile): NativeRepoCommitFileInput {
  if (f.source.kind === "file") {
    return { rel: f.rel, filePath: f.source.path, mode: f.mode ?? "100644" };
  }
  return { rel: f.rel, body: f.source.body, mode: f.mode ?? "100644" };
}

function wrapRepo(handle: NativeRepo): GitRepo {
  return {
    async resolveHead() {
      try {
        const res = await handle.resolveHead();
        return { ref: res.refName, commit: res.commit ?? null };
      } catch (err) {
        wrapGitError(err);
      }
    },

    async listTree(commitOid: string, prefix: string, opts?: { withSize?: boolean }): Promise<GitTreeEntry[] | null> {
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
    },

    async walkHistory(opts: GitWalkHistoryOptions): Promise<GitHistoryEntry[]> {
      try {
        const rows = await handle.walkHistory(opts.fromCommit, opts.prefix, opts.limit, opts.maxWalk);
        return rows.map((r) => ({
          commit: r.commit,
          tree: r.tree,
          committerTime: r.committerTime,
        }));
      } catch (err) {
        wrapGitError(err);
      }
    },

    async extractTree(opts: GitExtractTreeOptions): Promise<GitExtractTreeResult> {
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
    },

    async commit(input: GitCommitInput): Promise<string> {
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
              files: input.change.files === null ? undefined : input.change.files.map(toNativeFile),
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
        await input.beforeMoveRef(prepared);
      }
      try {
        await handle.casRef(input.ref, prepared.commit, input.parent ?? undefined);
      } catch (err) {
        wrapGitError(err);
      }
      return prepared.commit;
    },

    async close(): Promise<void> {
      handle.close();
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
