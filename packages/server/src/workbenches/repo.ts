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
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import git, { type TreeEntry } from "isomorphic-git";
import { removeLeftovers } from "./leftovers.js";

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

export class AgentStateRepo {
  private readonly gitdir: string;
  private readonly now: () => Date;
  private readonly log: (line: string) => void;
  private readonly limit: number;
  private readonly walk: number;
  /** Refused tree entry names already logged by this instance. */
  private readonly skipped = new Set<string>();

  /** `caps` lowers HISTORY_LIMIT and HISTORY_WALK (tests). */
  constructor(opts: {
    gitdir: string;
    now: () => Date;
    log: (line: string) => void;
    caps?: { versions?: number; commits?: number };
  }) {
    this.gitdir = path.resolve(opts.gitdir);
    this.now = opts.now;
    this.log = opts.log;
    this.limit = opts.caps?.versions ?? HISTORY_LIMIT;
    this.walk = opts.caps?.commits ?? HISTORY_WALK;
  }

  /**
   * Writes `files` as the subtree at `rel` on top of HEAD and commits it, dated `at` (default:
   * now; git keeps whole seconds); nothing when HEAD has exactly that tree there. Creates the
   * repository on first use. A file under a name git refuses is left out, with a log line.
   */
  commitPath(
    rel: string,
    files: SourceFile[],
    subject: string,
    opts: { at?: Date } = {},
  ): Promise<{ commit: string; changed: boolean }> {
    const kept = files.filter((f) => !hasGitName(f.rel));
    if (kept.length < files.length) {
      const names = files.filter((f) => hasGitName(f.rel)).map((f) => f.rel);
      this.log(`${rel}: left out of history, git refuses the name: ${names.join(", ")}`);
    }
    const blobs = kept.map((f) => ({ rel: f.rel, oid: blobOid(f.body) }));
    return this.serial(async () => {
      const head = (await this.head()) ?? (await this.create());
      if (head.commit !== null && (await this.subtree(head.commit, rel)) === hashTree(blobs)) {
        return { commit: head.commit.slice(0, SHORT), changed: false };
      }
      const tree = await this.writeFiles(kept);
      const commit = await this.commit(head, rel, tree, subject, opts.at ?? this.now());
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

  /** The files of `rel` at the listed version whose tree id has this 12-hex prefix; null when not listed. */
  async filesAt(rel: string, revision: string): Promise<SourceFile[] | null> {
    const version = (await this.versions(rel)).find((v) => v.tree.slice(0, SHORT) === revision);
    return version === undefined ? null : this.readFiles(version.tree, "");
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
      const entry = (await this.entries(tree)).find((e) => e.path === name);
      if (entry?.type !== "tree") return null;
      tree = entry.oid;
    }
    return tree;
  }

  /**
   * A tree's entries, parsed here rather than by the library, which refuses a whole tree for one
   * entry name git refuses: such an entry (written by another tool, or by an older server) is
   * left out, logged once.
   */
  private async entries(tree: string): Promise<TreeEntry[]> {
    const { type, object } = await git.readObject({ ...this.repo, oid: tree, format: "content" });
    if (type !== "tree") throw new Error(`${tree} is a ${type}, not a tree`);
    const body = Buffer.from(object as Uint8Array);
    const out: TreeEntry[] = [];
    for (let at = 0; at < body.length;) {
      const space = body.indexOf(0x20, at);
      const nul = space === -1 ? -1 : body.indexOf(0, space);
      if (nul === -1 || nul + 21 > body.length) throw new Error(`tree ${tree} is malformed`);
      const mode = body.subarray(at, space).toString();
      const name = body.subarray(space + 1, nul).toString("utf8");
      const oid = body.subarray(nul + 1, nul + 21).toString("hex");
      at = nul + 21;
      if (isGitName(name)) {
        if (!this.skipped.has(name)) {
          this.skipped.add(name);
          this.log(
            `tree ${tree.slice(0, SHORT)} holds a name git refuses, left out: ${JSON.stringify(name)}`,
          );
        }
        continue;
      }
      const isTree = mode === "40000" || mode === "040000";
      const kind = isTree ? "tree" : mode === "160000" ? "commit" : "blob";
      out.push({ mode: isTree ? "040000" : mode, path: name, oid, type: kind });
    }
    return out;
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
    // `.lock` is the name git itself stages a ref under and never reads as a branch.
    const file = path.join(this.gitdir, head.ref);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await writeWhole(file, `${commit}\n`, `${file}.lock`);
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
    const entries = tree === null ? [] : await this.entries(tree);
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

  /** Every file under a tree, paths relative to it. */
  private async readFiles(tree: string, prefix: string): Promise<SourceFile[]> {
    const out: SourceFile[] = [];
    for (const entry of await this.entries(tree)) {
      const rel = `${prefix}${entry.path}`;
      if (entry.type === "tree") out.push(...(await this.readFiles(entry.oid, `${rel}/`)));
      else if (entry.type === "blob") {
        out.push({ rel, body: (await git.readBlob({ ...this.repo, oid: entry.oid })).blob });
      }
    }
    return out;
  }
}
