/**
 * AgentStateRepo: the bare git repository `<agentDir>/agent_state.git/`, which records the files
 * of the Agent's `agent_state/` from beside it. A workbench's versions are the commits that
 * touched its folder, `workbenches/<id>`. Nothing inside `agent_state/` belongs to it, so packing,
 * importing or moving the Agent State never touches history.
 *
 * Delegates all repository operations to a contributed `GitEngine` / `GitRepo` handle
 * (packages/core/src/plugin/git.ts): `resolveHead`, `listTree`, `walkHistory`, `extractTree`, and
 * `commit`. There is no built-in engine, no N+1 single-object walk, and version extraction writes
 * directly to a staging directory on disk without routing file bytes through the JS heap.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  GitCommitInput,
  GitEngine,
  GitHistoryEntry,
  GitRepo,
  GitTreeEntry,
} from "@prismshadow/penguin-core/plugin";
import { removeLeftovers } from "./leftovers.js";
import {
  processIdentitySources,
  versionIdentities,
  type IdentitySources,
  type VersionAuthor,
} from "./git-identity.js";

/** Versions a history lists at most. */
export const HISTORY_LIMIT = 50;
/** Commits a history walks at most to find them. */
export const HISTORY_WALK = 2000;

/** One file of a workbench's source: its `/`-separated path inside the folder and its bytes. */
export interface SourceFile {
  rel: string;
  body: Uint8Array;
}

export interface RecordedVersion {
  /** The folder's tree id at that commit (12 hex): the revision the folder had then. */
  revision: string;
  /** The commit (12 hex). */
  commit: string;
  /** When it was committed (ISO, whole seconds: git keeps seconds). */
  savedAt: string;
}

const SHORT = 12;
const BRANCH = "main";
const EXCLUDE = `# Written by PenguinHarness for git run by a person with --work-tree=agent_state:
# data and the server's own files are not part of any version.
.vault.toml
.build/
.harness/
.plugin.json
node_modules/
*.penguin-tmp*
workbenches/*/state.json
`;

/** The Agent State repository of the Agent whose directory this is. */
export function agentStateRepoDir(agentDir: string): string {
  return path.join(agentDir, "agent_state.git");
}

import { isGitName } from "@prismshadow/penguin-library-agent/agent-vocab";
export { isGitName };

const hasGitName = (rel: string): boolean => rel.split("/").some(isGitName);

function objectId(type: "blob" | "tree", body: Uint8Array): string {
  return createHash("sha1").update(`${type} ${body.byteLength}\0`).update(body).digest("hex");
}

/** git's id of a file with these bytes (full hex). */
export function blobOid(body: Uint8Array): string {
  return objectId("blob", body);
}

/** Splits a file list at the first path segment: the files at this level, and each directory's files below it. */
function level<T extends { rel: string }>(
  files: readonly T[],
): { here: T[]; dirs: Map<string, T[]> } {
  const here: T[] = [];
  const dirs = new Map<string, T[]>();
  for (const file of files) {
    const slash = file.rel.indexOf("/");
    if (slash === -1) {
      here.push(file);
      continue;
    }
    const name = file.rel.slice(0, slash);
    const inner = dirs.get(name) ?? [];
    inner.push({ ...file, rel: file.rel.slice(slash + 1) });
    dirs.set(name, inner);
  }
  return { here, dirs };
}

/** git's id of the tree holding these files (full hex); names git reserves are left out. */
function hashTree(files: ReadonlyArray<{ rel: string; oid: string }>): string {
  const { here, dirs } = level(files.filter((f) => !hasGitName(f.rel)));
  const entries = [
    ...here.map((f) => ({ name: f.rel, mode: "100644", oid: f.oid, key: f.rel })),
    ...[...dirs].map(([name, inner]) => ({
      name,
      mode: "40000",
      oid: hashTree(inner),
      key: `${name}/`,
    })),
  ];
  entries.sort((a, b) => Buffer.compare(Buffer.from(a.key), Buffer.from(b.key)));
  const body = Buffer.concat(
    entries.flatMap((e) => [Buffer.from(`${e.mode} ${e.name}\0`), Buffer.from(e.oid, "hex")]),
  );
  return objectId("tree", body);
}

/** git's tree id (12 hex) of these files, computed in memory: the folder's revision. */
export function treeId(files: ReadonlyArray<{ rel: string; oid: string }>): string {
  return hashTree(files).slice(0, SHORT);
}

/** Writes `data` to `file` whole: a temporary name, flushed to disk, then renamed in. */
async function writeWhole(
  file: string,
  data: string | Uint8Array,
  temp = `${file}.penguin-tmp`,
): Promise<void> {
  const handle = await fs.promises.open(temp, "w");
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.promises.rename(temp, file);
}

/** The write in progress per repository, across instances: the next one starts once it settles. */
const writing = new Map<string, Promise<unknown>>();

export class AgentStateRepo {
  private readonly gitdir: string;
  private readonly now: () => Date;
  private readonly log: (line: string) => void;
  private readonly limit: number;
  private readonly walk: number;
  private readonly identity: IdentitySources;
  /** The contributed Git engine (./engines.ts); never a built-in one. */
  private readonly engine: GitEngine;
  /** Refused tree entry names already logged by this instance. */
  private readonly skipped = new Set<string>();

  constructor(opts: {
    gitdir: string;
    now: () => Date;
    log: (line: string) => void;
    caps?: { versions?: number; commits?: number };
    engine: GitEngine;
    identity?: IdentitySources;
  }) {
    this.gitdir = path.resolve(opts.gitdir);
    this.now = opts.now;
    this.log = opts.log;
    this.limit = opts.caps?.versions ?? HISTORY_LIMIT;
    this.walk = opts.caps?.commits ?? HISTORY_WALK;
    this.engine = opts.engine;
    this.identity = opts.identity ?? processIdentitySources();
  }

  /**
   * Writes `files` as the subtree at `rel` on top of HEAD and commits it, dated `at` (default:
   * now; git keeps whole seconds) and authored by `by` when a member asked for it; nothing when
   * HEAD's tree for the folder holds exactly these files. Creates the repository on first use.
   * A file under a name git refuses is left out, with a log line.
   */
  commitPath(
    rel: string,
    files: SourceFile[],
    subject: string,
    opts: { at?: Date; by?: VersionAuthor } = {},
  ): Promise<{ commit: string; changed: boolean }> {
    const kept = files.filter((f) => !hasGitName(f.rel));
    if (kept.length < files.length) {
      const names = files.filter((f) => hasGitName(f.rel)).map((f) => f.rel);
      this.log(`${rel}: left out of history, git refuses the name: ${names.join(", ")}`);
    }
    return this.serial(async () => {
      if (!(await this.exists())) await this.create();
      return this.withRepo(async (repo) => {
        const head = await repo.resolveHead();
        if (head.commit !== null) {
          const listed = await repo.listTree(head.commit, rel);
          if (listed !== null && this.holdsExactly(this.filterEntries(head.commit, listed), kept)) {
            return { commit: head.commit.slice(0, SHORT), changed: false };
          }
        }
        const commit = await repo.commit(
          this.commitOf(
            head,
            rel,
            kept.map((f) => ({ rel: f.rel, source: { kind: "bytes" as const, body: f.body } })),
            subject,
            opts.at ?? this.now(),
            opts.by,
          ),
        );
        return { commit: commit.slice(0, SHORT), changed: true };
      });
    });
  }

  /**
   * Commits a tree without `rel`; nothing when HEAD lacks it (or there is no repository).
   */
  removePath(rel: string, subject: string, opts: { by?: VersionAuthor } = {}): Promise<void> {
    return this.serial(async () => {
      if (!(await this.exists())) return;
      await this.withRepo(async (repo) => {
        const head = await repo.resolveHead();
        if (head.commit === null) return;
        const listed = await repo.listTree(head.commit, rel);
        if (listed === null) return;
        await repo.commit(this.commitOf(head, rel, null, subject, this.now(), opts.by));
      });
    });
  }

  /**
   * The versions of `rel`, newest first: at most HISTORY_LIMIT, found within HISTORY_WALK
   * commits. The version HEAD has is always listed, even when it is older than the walk.
   */
  async history(rel: string): Promise<RecordedVersion[]> {
    const rows = await this.versions(rel);
    return rows.map((v) => ({
      revision: v.tree.slice(0, SHORT),
      commit: v.commit.slice(0, SHORT),
      savedAt: new Date(v.committerTime * 1000).toISOString(),
    }));
  }

  /**
   * Extracts the files of `rel` at `revision` directly into an empty destination directory
   * (`destDir`) with zero file bytes routed through the JS heap. Returns the list of extracted
   * relative paths in Git tree order, or null when `revision` is not listed.
   */
  async extractAt(
    rel: string,
    revision: string,
    destDir: string,
    opts?: { validatePath?: (fileRel: string) => void },
  ): Promise<string[] | null> {
    if (!(await this.exists())) return null;
    return this.withRepo(async (repo) => {
      const head = await repo.resolveHead();
      if (head.commit === null) return null;
      const rows = await repo.walkHistory({
        fromCommit: head.commit,
        prefix: rel,
        limit: this.limit,
        maxWalk: this.walk,
      });
      const version = rows.find((v) => v.tree.slice(0, SHORT) === revision);
      if (version === undefined) return null;
      const rawEntries = await repo.listTree(version.commit, rel);
      if (rawEntries === null) return null;
      const safeEntries = this.filterEntries(version.tree, rawEntries);
      if (opts?.validatePath !== undefined) {
        for (const e of safeEntries) opts.validatePath(e.rel);
      }
      const hadRefused = safeEntries.length < rawEntries.length;
      const extracted = await repo.extractTree({
        commitOid: version.commit,
        prefix: rel,
        destDir,
        onlyPaths: hadRefused ? safeEntries.map((e) => e.rel) : undefined,
      });
      return extracted.files;
    });
  }

  /**
   * The files of `rel` at the listed version whose tree id has this 12-hex prefix, in Git's entry
   * order; null when not listed.
   */
  async filesAt(rel: string, revision: string): Promise<SourceFile[] | null> {
    const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "agent-state-files-"));
    try {
      const files = await this.extractAt(rel, revision, tmp);
      if (files === null) return null;
      const out: SourceFile[] = [];
      for (const fileRel of files) {
        out.push({ rel: fileRel, body: await fs.promises.readFile(path.join(tmp, fileRel)) });
      }
      return out;
    } finally {
      await fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  // ---- internals ------------------------------------------------------------------

  private async exists(): Promise<boolean> {
    try {
      await fs.promises.lstat(this.gitdir);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw err;
    }
  }

  private async withRepo<T>(fn: (repo: GitRepo) => Promise<T>): Promise<T> {
    const repo = await this.engine.open(this.gitdir);
    try {
      return await fn(repo);
    } finally {
      await repo.close();
    }
  }

  private serial<T>(write: () => Promise<T>): Promise<T> {
    const run = (writing.get(this.gitdir) ?? Promise.resolve()).then(write);
    const settled = run.catch(() => undefined);
    writing.set(this.gitdir, settled);
    void settled.then(() => {
      if (writing.get(this.gitdir) === settled) writing.delete(this.gitdir);
    });
    return run;
  }

  private filterEntries(treeOrCommit: string, entries: readonly GitTreeEntry[]): GitTreeEntry[] {
    return entries.filter((entry) => {
      const refusedSeg = entry.rel.split("/").find(isGitName);
      if (refusedSeg === undefined) return true;
      if (!this.skipped.has(refusedSeg)) {
        this.skipped.add(refusedSeg);
        this.log(
          `tree ${treeOrCommit.slice(0, SHORT)} holds a name git refuses, left out: ${JSON.stringify(refusedSeg)}`,
        );
      }
      return false;
    });
  }

  /** Whether a tree holds exactly these files, and nothing besides: an unchanged load. */
  private holdsExactly(listed: readonly GitTreeEntry[], files: SourceFile[]): boolean {
    if (listed.length !== files.length) return false;
    const want = new Map(files.map((f) => [f.rel, blobOid(f.body)] as const));
    return listed.every((f) => want.get(f.rel) === f.oid);
  }

  private commitOf(
    head: { ref: string; commit: string | null },
    rel: string,
    files: NonNullable<Extract<GitCommitInput["change"], { kind: "replace" }>["files"]> | null,
    subject: string,
    at: Date,
    by: VersionAuthor | undefined,
  ): GitCommitInput {
    return {
      ref: head.ref,
      parent: head.commit,
      prefix: rel,
      change: { kind: "replace", files },
      message: `${subject}\n`,
      ...versionIdentities(this.gitdir, this.identity, by),
      when: { seconds: Math.floor(at.getTime() / 1000), offset: 0 - at.getTimezoneOffset() },
    };
  }

  /**
   * A new bare repository on `main`, with the ignore rules a person's git reads. It is made
   * beside its place and renamed in, so a crash never leaves a repository without a HEAD; what
   * an earlier crash left there is cleared first.
   */
  private async create(): Promise<void> {
    const staging = `${path.basename(this.gitdir)}.penguin-tmp`;
    await removeLeftovers(path.dirname(this.gitdir), staging, this.now().getTime());
    const made = await fs.promises.mkdtemp(path.join(path.dirname(this.gitdir), staging));
    await fs.promises.mkdir(path.join(made, "objects", "info"), { recursive: true });
    await fs.promises.mkdir(path.join(made, "objects", "pack"), { recursive: true });
    await fs.promises.mkdir(path.join(made, "refs", "heads"), { recursive: true });
    await fs.promises.mkdir(path.join(made, "info"), { recursive: true });
    await writeWhole(path.join(made, "HEAD"), `ref: refs/heads/${BRANCH}\n`);
    await writeWhole(
      path.join(made, "config"),
      "[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = true\n",
    );
    await writeWhole(path.join(made, "info", "exclude"), EXCLUDE);
    await fs.promises.rename(made, this.gitdir);
  }

  private async versions(rel: string): Promise<GitHistoryEntry[]> {
    if (!(await this.exists())) return [];
    return this.withRepo(async (repo) => {
      const head = await repo.resolveHead();
      if (head.commit === null) return [];
      return repo.walkHistory({
        fromCommit: head.commit,
        prefix: rel,
        limit: this.limit,
        maxWalk: this.walk,
      });
    });
  }
}
