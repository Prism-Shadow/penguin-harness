/**
 * AgentStateRepo: the git repository over an Agent's `agent_state/`. A workbench's versions are
 * the commits that touched its folder, `workbenches/<id>`.
 *
 * Only plumbing is used: blobs, trees, commits and the branch ref are written directly, never
 * through the index or the working tree. A commit is therefore a function of HEAD's tree and the
 * files handed in — nothing on disk is staged, no ignore file is consulted, and an index left in
 * any state by a person cannot turn into a mass deletion. The index is brought up to date
 * afterwards, best effort, only so that `git status` run by a person reads clean.
 *
 * Every file is mode 100644 and a tree id is git's own, so the revision a folder gets in memory
 * (`treeId`) is what `git rev-parse HEAD:workbenches/<id>` prints once it is committed, and a
 * listed version's revision is the folder's tree at that commit.
 *
 * Writes run one at a time per instance (the server keeps one per Agent). Reads take no lock:
 * objects never change once written, and the library serialises a ref's reads and writes.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import git, { type TreeEntry } from "isomorphic-git";

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

const AUTHOR = { name: "PenguinHarness", email: "penguin@localhost" };
const SHORT = 12;
const BRANCH = "main";
const IGNORE = `# Written by PenguinHarness: data and the server's own files stay out of history.
.vault.toml
.build/
.harness/
.plugin.json
node_modules/
*.penguin-tmp*
workbenches/*/state.json
`;

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

/** git's id of the tree holding these files (full hex). */
function hashTree(files: ReadonlyArray<{ rel: string; oid: string }>): string {
  const { here, dirs } = level(files);
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

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export class AgentStateRepo {
  private readonly dir: string;
  private readonly now: () => Date;
  private readonly log: (line: string) => void;
  /** The write in progress; the next one starts once it has settled. */
  private writing: Promise<unknown> = Promise.resolve();

  constructor(opts: { stateDir: string; now: () => Date; log: (line: string) => void }) {
    this.dir = opts.stateDir;
    this.now = opts.now;
    this.log = opts.log;
  }

  /**
   * Writes `files` as the subtree at `rel` on top of HEAD and commits it, dated `at` (default:
   * now); nothing when HEAD has exactly that tree there. Creates the repository and its
   * `.gitignore` on first use.
   */
  commitPath(
    rel: string,
    files: SourceFile[],
    subject: string,
    opts: { at?: Date } = {},
  ): Promise<{ commit: string; changed: boolean }> {
    const blobs = files.map((f) => ({ rel: f.rel, oid: blobOid(f.body) }));
    return this.serial(async () => {
      const head = (await this.head()) ?? (await this.create());
      if (head.commit !== null && (await this.subtree(head.commit, rel)) === hashTree(blobs)) {
        return { commit: head.commit.slice(0, SHORT), changed: false };
      }
      const tree = await this.writeFiles(files);
      const commit = await this.commit(head, rel, tree, subject, opts.at ?? this.now());
      await this.syncIndex(rel, blobs);
      return { commit: commit.slice(0, SHORT), changed: true };
    });
  }

  /** Commits a tree without `rel`; nothing when HEAD lacks it (or there is no repository). */
  removePath(rel: string, subject: string): Promise<void> {
    return this.serial(async () => {
      const head = await this.head();
      if (head === null || head.commit === null) return;
      if ((await this.subtree(head.commit, rel)) === null) return;
      await this.commit(head, rel, null, subject, this.now());
      await this.syncIndex(rel, []);
    });
  }

  /** The versions of `rel`, newest first (at most HISTORY_LIMIT within HISTORY_WALK commits). */
  async history(rel: string): Promise<RecordedVersion[]> {
    return (await this.versions(rel)).map((v) => ({
      revision: v.tree.slice(0, SHORT),
      commit: v.commit.slice(0, SHORT),
      savedAt: v.savedAt,
    }));
  }

  /** The files of `rel` at the listed version whose tree id has this 12-hex prefix; null when not listed. */
  async filesAt(rel: string, revision: string): Promise<SourceFile[] | null> {
    const version = (await this.versions(rel)).find((v) => v.tree.slice(0, SHORT) === revision);
    return version === undefined ? null : this.readFiles(version.tree, "");
  }

  // ---- internals ------------------------------------------------------------------

  private serial<T>(write: () => Promise<T>): Promise<T> {
    const run = this.writing.then(write);
    this.writing = run.catch(() => undefined);
    return run;
  }

  private get repo() {
    return { fs, dir: this.dir };
  }

  /**
   * The branch HEAD names and its commit (null before the first one); null when there is no
   * repository. A detached or unreadable HEAD is an error: no version is recorded or listed
   * against it.
   */
  private async head(): Promise<{ ref: string; commit: string | null } | null> {
    try {
      await fs.promises.lstat(path.join(this.dir, ".git"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
    const ref = await git.currentBranch({ ...this.repo, fullname: true });
    if (!ref) throw new Error("agent_state/.git has a detached HEAD");
    try {
      return { ref, commit: await git.resolveRef({ ...this.repo, ref }) };
    } catch (err) {
      if (isNotFound(err)) return { ref, commit: null };
      throw err;
    }
  }

  /** A new repository on `main`, and the ignore file a person's git reads (kept if one is there). */
  private async create(): Promise<{ ref: string; commit: null }> {
    await git.init({ ...this.repo, defaultBranch: BRANCH });
    try {
      await fs.promises.writeFile(path.join(this.dir, ".gitignore"), IGNORE, { flag: "wx" });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    return { ref: `refs/heads/${BRANCH}`, commit: null };
  }

  /** The id of the tree at `rel` in a commit; null when the commit has nothing there. */
  private async subtree(commit: string, rel: string): Promise<string | null> {
    try {
      return (await git.readTree({ ...this.repo, oid: commit, filepath: rel })).oid;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  /** Writes the files' blobs and trees; returns the top tree's id. */
  private async writeFiles(files: readonly SourceFile[]): Promise<string> {
    const { here, dirs } = level(files);
    const tree: TreeEntry[] = [];
    for (const file of here) {
      const oid = await git.writeBlob({ ...this.repo, blob: file.body });
      tree.push({ mode: "100644", path: file.rel, oid, type: "blob" });
    }
    for (const [name, inner] of dirs) {
      tree.push({ mode: "040000", path: name, oid: await this.writeFiles(inner), type: "tree" });
    }
    return git.writeTree({ ...this.repo, tree });
  }

  /** Commits HEAD's tree with `tree` at `rel` (null: without it) and moves the branch to it. */
  private async commit(
    head: { ref: string; commit: string | null },
    rel: string,
    tree: string | null,
    subject: string,
    at: Date,
  ): Promise<string> {
    const root =
      head.commit === null
        ? null
        : (await git.readCommit({ ...this.repo, oid: head.commit })).commit.tree;
    const next =
      (await this.splice(root, rel.split("/"), tree)) ??
      (await git.writeTree({ ...this.repo, tree: [] }));
    const stamp = {
      ...AUTHOR,
      timestamp: Math.floor(at.getTime() / 1000),
      timezoneOffset: at.getTimezoneOffset(),
    };
    const commit = await git.writeCommit({
      ...this.repo,
      commit: {
        message: `${subject}\n`,
        tree: next,
        parent: head.commit === null ? [] : [head.commit],
        author: stamp,
        committer: stamp,
      },
    });
    await git.writeRef({ ...this.repo, ref: head.ref, value: commit, force: true });
    return commit;
  }

  /**
   * Writes a copy of `tree` whose entry at `segments` is `value` (null: removed), and of every
   * tree on the way down; null when nothing is left in it, as git keeps no empty directory.
   */
  private async splice(
    tree: string | null,
    segments: string[],
    value: string | null,
  ): Promise<string | null> {
    const [name = "", ...rest] = segments;
    const entries = tree === null ? [] : (await git.readTree({ ...this.repo, oid: tree })).tree;
    const existing = entries.find((e) => e.path === name);
    const child =
      rest.length === 0
        ? value
        : await this.splice(existing?.type === "tree" ? existing.oid : null, rest, value);
    const kept = entries.filter((e) => e.path !== name);
    const next: TreeEntry[] =
      child === null ? kept : [...kept, { mode: "040000", path: name, oid: child, type: "tree" }];
    return next.length === 0 ? null : git.writeTree({ ...this.repo, tree: next });
  }

  /**
   * The commits from HEAD down the first parents where the tree at `rel` differs from the
   * parent's, newest first. The walk stops where `rel` is absent, so a folder deleted and made
   * again lists only its new life.
   */
  private async versions(
    rel: string,
  ): Promise<Array<{ tree: string; commit: string; savedAt: string }>> {
    const out: Array<{ tree: string; commit: string; savedAt: string }> = [];
    let oid = (await this.head())?.commit ?? null;
    let tree = oid === null ? null : await this.subtree(oid, rel);
    let walked = 0;
    while (oid !== null && tree !== null && out.length < HISTORY_LIMIT && walked < HISTORY_WALK) {
      walked += 1;
      const { commit } = await git.readCommit({ ...this.repo, oid });
      const parent = commit.parent[0] ?? null;
      const before = parent === null ? null : await this.subtree(parent, rel);
      if (before !== tree) {
        const savedAt = new Date(commit.committer.timestamp * 1000).toISOString();
        out.push({ tree, commit: oid, savedAt });
      }
      oid = parent;
      tree = before;
    }
    return out;
  }

  /** Every file under a tree, paths relative to it. */
  private async readFiles(tree: string, prefix: string): Promise<SourceFile[]> {
    const out: SourceFile[] = [];
    for (const entry of (await git.readTree({ ...this.repo, oid: tree })).tree) {
      const rel = `${prefix}${entry.path}`;
      if (entry.type === "tree") out.push(...(await this.readFiles(entry.oid, `${rel}/`)));
      else if (entry.type === "blob") {
        out.push({ rel, body: (await git.readBlob({ ...this.repo, oid: entry.oid })).blob });
      }
    }
    return out;
  }

  /** Points the index at what was just committed under `rel`, so `git status` reads clean there. */
  private async syncIndex(
    rel: string,
    files: ReadonlyArray<{ rel: string; oid: string }>,
  ): Promise<void> {
    const prefix = `${rel}/`;
    const wanted = new Map(files.map((f) => [`${prefix}${f.rel}`, f.oid]));
    try {
      for (const filepath of await git.listFiles(this.repo)) {
        if (filepath.startsWith(prefix) && !wanted.has(filepath)) {
          await git.updateIndex({ ...this.repo, filepath, remove: true, force: true });
        }
      }
      for (const [filepath, oid] of wanted) {
        await git.updateIndex({ ...this.repo, filepath, oid, add: true });
      }
    } catch (err) {
      this.log(`git index not updated: ${messageOf(err)}`);
    }
  }
}
