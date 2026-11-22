/**
 * AgentStateRepo: the bare git repository `<agentDir>/agent_state.git/`, which records the files
 * of the Agent's `agent_state/` from beside it. A workbench's versions are the commits that
 * touched its folder, `workbenches/<id>`. Nothing inside `agent_state/` belongs to it, so packing,
 * importing or moving the Agent State never touches history.
 *
 * Only plumbing is used: blobs, trees, commits and the branch ref are written directly; there is
 * no index and no working tree. A commit is therefore a function of HEAD's tree and the files
 * handed in. The ignore rules a person's git reads (`info/exclude`) are written once and never
 * consulted here.
 *
 * Every file is mode 100644 and a tree id is git's own, so the revision a folder gets in memory
 * (`treeId`) is what `git --git-dir=… rev-parse HEAD:workbenches/<id>` prints once it is
 * committed, and a listed version's revision is the folder's tree at that commit. A name git
 * refuses in a tree (`isGitName`) is never written into one, and one found in a tree written
 * elsewhere is skipped on reading, with a log line, rather than failing the whole history.
 *
 * Every file the repository gets is written whole: to a temporary name, flushed, then renamed
 * in. An object file a crash left empty or cut short counts as absent, so the next write of the
 * same object replaces it instead of building on it.
 *
 * Writes to one repository run one at a time in this process, whichever instance makes them.
 * Reads take no lock: objects never change once written, and the branch ref is replaced whole.
 *
 * What is cheap in-process always runs here: HEAD, the trees, whether a load changed anything,
 * the history walk, creating the repository, and which names git refuses. The two steps whose
 * cost grows with the files — writing one commit, and reading a version's blobs back — go to an
 * ENGINE (`AgentStateEngine`, core's plugin contract). The built-in one below works through
 * isomorphic-git; a plugin may contribute another (./engines.ts), and it is handed a step only
 * from the folder size the engine says it is faster from (`fasterFrom`): a commit of at least
 * that many files, a restore of at least that many. Everything smaller, and every removal (a few
 * trees and a commit), stays built-in. An engine that cannot run at all is
 * replaced by the built-in one for that step, with a log line; git refusing a write is not. Both
 * write the same bytes, so the same input is the same commit under either.
 *
 * Who a version is by comes from ./git-identity.ts: the member who asked for it, else the
 * server's Git identity, read the way git reads it.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import git, { type TreeEntry } from "isomorphic-git";
import type {
  AgentStateCommit,
  AgentStateEngine,
  AgentStateFile,
  AgentStateIdentity,
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
export type SourceFile = AgentStateFile;

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

/** The characters HFS+ ignores in a name. */
const HFS_IGNORED = /[\u200C-\u200F\u202A-\u202E\u206A-\u206F\uFEFF]/g;

/**
 * A tree entry name git refuses, by isomorphic-git's own check (git's `verify_path`): one that
 * holds a path separator, that is `.` or `..` once the characters HFS+ ignores are dropped, or
 * that spells `.git` — any case, trailing dots or spaces (NTFS), an NTFS short name (`git~1`),
 * or before a `:` stream.
 */
export function isGitName(name: string): boolean {
  const visible = name.replace(HFS_IGNORED, "");
  const normalized = (visible.split(":")[0] ?? "").toLowerCase().replace(/[. ]+$/, "");
  return (
    name.includes("/") ||
    name.includes("\\") ||
    visible === "." ||
    visible === ".." ||
    normalized === ".git" ||
    /^\.?git~[1-9]$/.test(normalized)
  );
}

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
  // git orders entries by the bytes of their names, a directory's as if it ended in `/`.
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

const isNotFound = (err: unknown): boolean =>
  (err as { code?: unknown } | null)?.code === "NotFoundError";

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

const LOOSE_OBJECT = /[\\/]objects[\\/][0-9a-f]{2}[\\/][0-9a-f]{38}$/;

/**
 * The filesystem isomorphic-git works through. Its writes are whole (writeWhole), and a loose
 * object that does not inflate (a crash left it empty or cut short) is not there for it: the
 * library writes an object only when it finds none, and would otherwise build on the damaged one.
 */
const gitFs = {
  promises: {
    ...fs.promises,
    writeFile: (file: string, data: string | Uint8Array) => writeWhole(file, data),
    async stat(file: string) {
      const stats = await fs.promises.stat(file);
      if (LOOSE_OBJECT.test(file)) {
        try {
          inflateSync(await fs.promises.readFile(file));
        } catch {
          throw Object.assign(new Error(`ENOENT: damaged object ${file}`), { code: "ENOENT" });
        }
      }
      return stats;
    },
  },
};

/** The write in progress per repository, across instances: the next one starts once it settles. */
const writing = new Map<string, Promise<unknown>>();

/** Whether an engine could not run at all (core's `AgentStateEngineUnavailable`). */
const isUnavailable = (err: unknown): boolean =>
  (err as { engineUnavailable?: unknown } | null)?.engineUnavailable === true;

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** One tree entry as git stores it: mode `40000` is a tree, `160000` a submodule. */
interface RawEntry {
  mode: string;
  name: string;
  oid: string;
}

/** A tree's entries as git stores them: mode, name, the object's id (full hex). */
function parseTree(tree: string, body: Uint8Array): RawEntry[] {
  const bytes = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  const out: RawEntry[] = [];
  for (let at = 0; at < bytes.length;) {
    const space = bytes.indexOf(0x20, at);
    const nul = space === -1 ? -1 : bytes.indexOf(0, space);
    if (nul === -1 || nul + 21 > bytes.length) throw new Error(`tree ${tree} is malformed`);
    out.push({
      mode: bytes.subarray(at, space).toString(),
      name: bytes.subarray(space + 1, nul).toString("utf8"),
      oid: bytes.subarray(nul + 1, nul + 21).toString("hex"),
    });
    at = nul + 21;
  }
  return out;
}

const isTreeMode = (mode: string): boolean => mode === "40000" || mode === "040000";

/** isomorphic-git's stamp for one identity line (its zone is JavaScript's: minutes WEST of UTC). */
const stamp = (who: AgentStateIdentity, when: AgentStateCommit["when"]) => ({
  ...who,
  timestamp: when.seconds,
  timezoneOffset: 0 - when.offset,
});

/** Writes the files' blobs and trees; returns the top tree's id. */
async function writeFiles(gitdir: string, files: readonly SourceFile[]): Promise<string> {
  const repo = { fs: gitFs, gitdir };
  const { here, dirs } = level(files);
  const tree: TreeEntry[] = [];
  for (const file of here) {
    const oid = await git.writeBlob({ ...repo, blob: file.body });
    tree.push({ mode: "100644", path: file.rel, oid, type: "blob" });
  }
  for (const [name, inner] of dirs) {
    tree.push({ mode: "040000", path: name, oid: await writeFiles(gitdir, inner), type: "tree" });
  }
  return git.writeTree({ ...repo, tree });
}

/**
 * The built-in engine: isomorphic-git through the whole-file filesystem above. It reads trees
 * through the harness's own parser, so an entry git refuses is left out of what it rewrites.
 */
export const builtinEngine: AgentStateEngine = {
  name: "isomorphic-git",

  async commit(c) {
    const repo = { fs: gitFs, gitdir: c.gitdir };
    const read = async (tree: string): Promise<TreeEntry[]> => {
      const { type, object } = await git.readObject({ ...repo, oid: tree, format: "content" });
      if (type !== "tree") throw new Error(`${tree} is a ${type}, not a tree`);
      return parseTree(tree, object as Uint8Array)
        .filter((e) => !isGitName(e.name))
        .map((e): TreeEntry => {
          const isTree = isTreeMode(e.mode);
          const kind = isTree ? "tree" : e.mode === "160000" ? "commit" : "blob";
          return { mode: isTree ? "040000" : e.mode, path: e.name, oid: e.oid, type: kind };
        });
    };
    /**
     * A copy of `tree` whose entry at `segments` is `value` (null: removed), and of every tree on
     * the way down; null when nothing is left in it, as git keeps no empty directory.
     */
    const splice = async (
      tree: string | null,
      segments: string[],
      value: string | null,
    ): Promise<string | null> => {
      const [name = "", ...rest] = segments;
      const entries = tree === null ? [] : await read(tree);
      const existing = entries.find((e) => e.path === name);
      const child =
        rest.length === 0
          ? value
          : await splice(existing?.type === "tree" ? existing.oid : null, rest, value);
      const kept = entries.filter((e) => e.path !== name);
      const next: TreeEntry[] =
        child === null ? kept : [...kept, { mode: "040000", path: name, oid: child, type: "tree" }];
      return next.length === 0 ? null : git.writeTree({ ...repo, tree: next });
    };
    const tree = c.files === null ? null : await writeFiles(c.gitdir, c.files);
    const root =
      c.parent === null ? null : (await git.readCommit({ ...repo, oid: c.parent })).commit.tree;
    const next =
      (await splice(root, c.rel.split("/"), tree)) ?? (await git.writeTree({ ...repo, tree: [] }));
    const commit = await git.writeCommit({
      ...repo,
      commit: {
        message: c.message,
        tree: next,
        parent: c.parent === null ? [] : [c.parent],
        author: stamp(c.author, c.when),
        committer: stamp(c.committer, c.when),
      },
    });
    // `.lock` is the name git itself stages a ref under and never reads as a branch.
    const file = path.join(c.gitdir, c.ref);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await writeWhole(file, `${commit}\n`, `${file}.lock`);
    return commit;
  },

  async readBlobs(gitdir, oids) {
    const out: Uint8Array[] = [];
    for (const oid of oids) out.push((await git.readBlob({ fs: gitFs, gitdir, oid })).blob);
    return out;
  },
};

export class AgentStateRepo {
  private readonly gitdir: string;
  private readonly now: () => Date;
  private readonly log: (line: string) => void;
  private readonly limit: number;
  private readonly walk: number;
  private readonly identity: IdentitySources;
  private readonly from: { commit: number; read: number };
  private readonly onEngineUnavailable: (engine: AgentStateEngine) => void;
  /** The engine that writes commits and reads versions back; the built-in one once another failed to run. */
  private engine: AgentStateEngine;
  /** Refused tree entry names already logged by this instance. */
  private readonly skipped = new Set<string>();

  /**
   * `caps` lowers HISTORY_LIMIT and HISTORY_WALK (tests). `engine` is a contributed engine to use
   * instead of the built-in one, from the sizes it is faster from (`engineFrom` overrides them, for
   * the tests and the bench); `onEngineUnavailable` hears when it could not run. `identity` is
   * where the server's Git identity is read from: the process's environment and home unless given.
   */
  constructor(opts: {
    gitdir: string;
    now: () => Date;
    log: (line: string) => void;
    caps?: { versions?: number; commits?: number };
    engine?: AgentStateEngine | null;
    engineFrom?: { commit?: number; read?: number };
    onEngineUnavailable?: (engine: AgentStateEngine) => void;
    identity?: IdentitySources;
  }) {
    this.gitdir = path.resolve(opts.gitdir);
    this.now = opts.now;
    this.log = opts.log;
    this.limit = opts.caps?.versions ?? HISTORY_LIMIT;
    this.walk = opts.caps?.commits ?? HISTORY_WALK;
    this.engine = opts.engine ?? builtinEngine;
    this.from = {
      commit: opts.engineFrom?.commit ?? this.engine.fasterFrom?.commit ?? 1,
      read: opts.engineFrom?.read ?? this.engine.fasterFrom?.read ?? 1,
    };
    this.onEngineUnavailable = opts.onEngineUnavailable ?? (() => {});
    this.identity = opts.identity ?? processIdentitySources();
  }

  /**
   * Writes `files` as the subtree at `rel` on top of HEAD and commits it, dated `at` (default:
   * now; git keeps whole seconds) and authored by `by` when a member asked for it; nothing when
   * HEAD has exactly that tree there. Creates the repository on first use. A file under a name
   * git refuses is left out, with a log line.
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
    const tree = hashTree(kept.map((f) => ({ rel: f.rel, oid: blobOid(f.body) })));
    // An empty folder is an empty subtree, which only the built-in engine writes.
    const contributed = kept.length > 0 && kept.length >= this.from.commit;
    return this.serial(() =>
      this.withEngine(contributed, async (engine) => {
        const head = (await this.head()) ?? (await this.create());
        if (head.commit !== null && (await this.subtree(head.commit, rel)) === tree) {
          return { commit: head.commit.slice(0, SHORT), changed: false };
        }
        const commit = await engine.commit(
          this.commitOf(head, rel, kept, subject, opts.at ?? this.now(), opts.by),
        );
        return { commit: commit.slice(0, SHORT), changed: true };
      }),
    );
  }

  /**
   * Commits a tree without `rel`; nothing when HEAD lacks it (or there is no repository). A few
   * trees and a commit: always the built-in engine's.
   */
  removePath(rel: string, subject: string, opts: { by?: VersionAuthor } = {}): Promise<void> {
    return this.serial(async () => {
      const head = await this.head();
      if (head === null || head.commit === null) return;
      if ((await this.subtree(head.commit, rel)) === null) return;
      await builtinEngine.commit(this.commitOf(head, rel, null, subject, this.now(), opts.by));
    });
  }

  /**
   * The versions of `rel`, newest first: at most HISTORY_LIMIT, found within HISTORY_WALK
   * commits. The version HEAD has is always listed, even when it is older than the walk.
   */
  async history(rel: string): Promise<RecordedVersion[]> {
    return (await this.versions(rel)).map((v) => ({
      revision: v.tree.slice(0, SHORT),
      commit: v.commit.slice(0, SHORT),
      savedAt: v.savedAt,
    }));
  }

  /**
   * The files of `rel` at the listed version whose tree id has this 12-hex prefix, in the order a
   * depth-first walk of git's entry order meets them; null when not listed.
   */
  async filesAt(rel: string, revision: string): Promise<SourceFile[] | null> {
    const version = (await this.versions(rel)).find((v) => v.tree.slice(0, SHORT) === revision);
    if (version === undefined) return null;
    const listed = await this.listFiles(version.tree, "");
    const oids = [...new Set(listed.map((f) => f.oid))];
    const bodies = await this.withEngine(listed.length >= this.from.read, (engine) =>
      engine.readBlobs(this.gitdir, oids),
    );
    const byOid = new Map(oids.map((oid, i) => [oid, bodies[i]!] as const));
    return listed.map((f) => ({ rel: f.rel, body: byOid.get(f.oid)! }));
  }

  // ---- internals ------------------------------------------------------------------

  private serial<T>(write: () => Promise<T>): Promise<T> {
    const run = (writing.get(this.gitdir) ?? Promise.resolve()).then(write);
    const settled = run.catch(() => undefined);
    writing.set(this.gitdir, settled);
    void settled.then(() => {
      if (writing.get(this.gitdir) === settled) writing.delete(this.gitdir);
    });
    return run;
  }

  /**
   * Runs one step with the contributed engine when `contributed` says it is worth it, else with
   * the built-in one. When a contributed engine could not run at all, says so once and runs the
   * whole step again with the built-in one, from what HEAD says by then.
   */
  private async withEngine<T>(
    contributed: boolean,
    step: (engine: AgentStateEngine) => Promise<T>,
  ): Promise<T> {
    const engine = this.engine;
    if (!contributed || engine === builtinEngine) return step(builtinEngine);
    try {
      return await step(engine);
    } catch (err) {
      if (!isUnavailable(err)) throw err;
      this.log(`${engine.name} could not run (${messageOf(err)}); the built-in engine takes over`);
      this.engine = builtinEngine;
      this.onEngineUnavailable(engine);
      return step(builtinEngine);
    }
  }

  /** One commit of `rel` on HEAD, stamped now (or `at`) and attributed per ./git-identity.ts. */
  private commitOf(
    head: { ref: string; commit: string | null },
    rel: string,
    files: SourceFile[] | null,
    subject: string,
    at: Date,
    by: VersionAuthor | undefined,
  ): AgentStateCommit {
    return {
      gitdir: this.gitdir,
      ref: head.ref,
      parent: head.commit,
      rel,
      files,
      message: `${subject}\n`,
      ...versionIdentities(this.gitdir, this.identity, by),
      when: { seconds: Math.floor(at.getTime() / 1000), offset: 0 - at.getTimezoneOffset() },
    };
  }

  private get repo() {
    return { fs: gitFs, gitdir: this.gitdir };
  }

  /**
   * The branch HEAD names and its commit (null before the first one); null when there is no
   * repository. A detached or unreadable HEAD, or a branch ref that is not a commit id, is an
   * error: no version is recorded or listed against it.
   */
  private async head(): Promise<{ ref: string; commit: string | null } | null> {
    try {
      await fs.promises.lstat(this.gitdir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
    const ref = await git.currentBranch({ ...this.repo, fullname: true });
    if (!ref) throw new Error(`${this.gitdir} has a detached HEAD`);
    let loose: string;
    try {
      loose = (await fs.promises.readFile(path.join(this.gitdir, ref), "utf8")).trim();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      // No file of its own: packed by a person's git, or a branch with no commit yet.
      try {
        return { ref, commit: await git.resolveRef({ ...this.repo, ref }) };
      } catch (packed) {
        if (isNotFound(packed)) return { ref, commit: null };
        throw packed;
      }
    }
    if (!/^[0-9a-f]{40}$/.test(loose))
      throw new Error(`${ref} in ${this.gitdir} is not a commit id`);
    return { ref, commit: loose };
  }

  /**
   * A new bare repository on `main`, with the ignore rules a person's git reads. It is made
   * beside its place and renamed in, so a crash never leaves a repository without a HEAD; what
   * an earlier crash left there is cleared first.
   */
  private async create(): Promise<{ ref: string; commit: null }> {
    const staging = `${path.basename(this.gitdir)}.penguin-tmp`;
    await removeLeftovers(path.dirname(this.gitdir), staging, this.now().getTime());
    const made = await fs.promises.mkdtemp(path.join(path.dirname(this.gitdir), staging));
    await git.init({ fs: gitFs, gitdir: made, bare: true, defaultBranch: BRANCH });
    await fs.promises.mkdir(path.join(made, "info"), { recursive: true });
    await writeWhole(path.join(made, "info", "exclude"), EXCLUDE);
    await fs.promises.rename(made, this.gitdir);
    return { ref: `refs/heads/${BRANCH}`, commit: null };
  }

  /**
   * The id of the tree at `rel` in a commit; null when the commit has nothing there, or is not
   * in the repository at all (the parent of a shallow copy's oldest commit).
   */
  private async subtree(commit: string, rel: string): Promise<string | null> {
    let tree: string;
    try {
      tree = (await git.readCommit({ ...this.repo, oid: commit })).commit.tree;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
    for (const name of rel.split("/")) {
      const entry = (await this.entries(tree)).find((e) => e.name === name);
      if (entry === undefined || !isTreeMode(entry.mode)) return null;
      tree = entry.oid;
    }
    return tree;
  }

  /** Every file under a tree, paths relative to it, depth first in git's entry order; submodules skipped. */
  private async listFiles(
    tree: string,
    prefix: string,
  ): Promise<Array<{ rel: string; oid: string }>> {
    const out: Array<{ rel: string; oid: string }> = [];
    for (const entry of await this.entries(tree)) {
      const rel = `${prefix}${entry.name}`;
      if (isTreeMode(entry.mode)) out.push(...(await this.listFiles(entry.oid, `${rel}/`)));
      else if (entry.mode !== "160000") out.push({ rel, oid: entry.oid });
    }
    return out;
  }

  /** A tree's entries, read here (see entriesOf). */
  private async entries(tree: string): Promise<RawEntry[]> {
    const { type, object } = await git.readObject({ ...this.repo, oid: tree, format: "content" });
    if (type !== "tree") throw new Error(`${tree} is a ${type}, not a tree`);
    return this.entriesOf(tree, object as Uint8Array);
  }

  /**
   * A tree's entries, parsed here rather than by the library, which refuses a whole tree for one
   * entry name git refuses: such an entry (written by another tool, or by an older server) is
   * left out, logged once.
   */
  private entriesOf(tree: string, body: Uint8Array): RawEntry[] {
    return parseTree(tree, body).filter((entry) => {
      if (!isGitName(entry.name)) return true;
      if (!this.skipped.has(entry.name)) {
        this.skipped.add(entry.name);
        this.log(
          `tree ${tree.slice(0, SHORT)} holds a name git refuses, left out: ${JSON.stringify(entry.name)}`,
        );
      }
      return false;
    });
  }

  /**
   * The commits from HEAD down the first parents where the tree at `rel` differs from the
   * parent's, newest first. The walk stops where `rel` is absent, so a folder deleted and made
   * again lists only its new life. When the walk ends before it finds where HEAD's version
   * began, that version is listed with the oldest commit it reached, which already had it.
   */
  private async versions(
    rel: string,
  ): Promise<Array<{ tree: string; commit: string; savedAt: string }>> {
    const out: Array<{ tree: string; commit: string; savedAt: string }> = [];
    let oid = (await this.head())?.commit ?? null;
    let tree = oid === null ? null : await this.subtree(oid, rel);
    const current = tree;
    let oldest: { commit: string; savedAt: string } | null = null;
    let walked = 0;
    while (oid !== null && tree !== null && out.length < this.limit && walked < this.walk) {
      walked += 1;
      const { commit } = await git.readCommit({ ...this.repo, oid });
      const savedAt = new Date(commit.committer.timestamp * 1000).toISOString();
      oldest = { commit: oid, savedAt };
      const parent = commit.parent[0] ?? null;
      const before = parent === null ? null : await this.subtree(parent, rel);
      if (before !== tree) out.push({ tree, commit: oid, savedAt });
      oid = parent;
      tree = before;
    }
    if (out.length === 0 && current !== null && oldest !== null)
      out.push({ tree: current, ...oldest });
    return out;
  }
}
