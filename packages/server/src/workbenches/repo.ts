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
 * Git installs its objects and updates the branch with its own ref lock. A damaged loose
 * object from an earlier server is repaired when the same content is written again.
 * Writes in this process serialize per repository. An outside writer moving the branch
 * causes the compare-and-swap to fail instead of losing either writer's history.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { commitIdentity, runGit } from "./git.js";
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

interface TreeEntry {
  mode: string;
  path: string;
  oid: string;
  type: "tree" | "blob" | "commit";
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
 * A tree entry name excluded on every supported filesystem: one that
 * holds a path separator, that is `.` or `..` once the characters HFS+ ignores are dropped, or
 * that spells `.git` — any case, trailing dots or spaces (NTFS), an NTFS short name (`git~1`),
 * or before a `:` stream.
 */
export function isGitName(name: string): boolean {
  const visible = name.replace(HFS_IGNORED, "");
  const normalized = (visible.split(":")[0] ?? "").toLowerCase().replace(/[. ]+$/, "");
  return (
    !name ||
    name.includes("\0") ||
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

  private git(args: string[], input?: Uint8Array | string): Promise<Buffer> {
    return runGit(this.gitdir, args, { input });
  }

  private async head(): Promise<{ ref: string; commit: string | null } | null> {
    try {
      if (!(await fs.promises.lstat(this.gitdir)).isDirectory())
        throw new Error(`Expected an Agent State repository directory at ${this.gitdir}`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
    if ((await this.git(["rev-parse", "--is-bare-repository"])).toString().trim() !== "true")
      throw new Error(`${this.gitdir} is not a bare repository`);
    const ref = (await this.git(["symbolic-ref", "HEAD"])).toString().trim();
    if (!ref.startsWith("refs/heads/")) throw new Error(`Invalid Agent State branch: ${ref}`);
    const commit = (
      await runGit(this.gitdir, ["rev-parse", "--verify", "--quiet", ref], { allowMissing: true })
    )
      .toString()
      .trim();
    if (!commit) {
      // Git's quiet lookup also returns 1 for a malformed loose ref. Only a genuinely unborn
      // branch may be the parent of a new root commit.
      try {
        await fs.promises.lstat(path.join(this.gitdir, ref));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ref, commit: null };
        throw err;
      }
      throw new Error(`${ref} in ${this.gitdir} is not a commit id`);
    }
    return { ref, commit };
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
    try {
      await runGit(made, [
        "init",
        "--bare",
        "--object-format=sha1",
        "--template=",
        `--initial-branch=${BRANCH}`,
        made,
      ]);
      await fs.promises.mkdir(path.join(made, "info"), { recursive: true });
      await fs.promises.writeFile(path.join(made, "info", "exclude"), EXCLUDE);
      await fs.promises.rename(made, this.gitdir);
    } finally {
      await fs.promises.rm(made, { recursive: true, force: true });
    }
    return { ref: `refs/heads/${BRANCH}`, commit: null };
  }

  /**
   * The id of the tree at `rel` in a commit; null when the commit has nothing there, or is not
   * in the repository at all (the parent of a shallow copy's oldest commit).
   */
  private async subtree(commit: string, rel: string): Promise<string | null> {
    const item = await this.git(["--literal-pathspecs", "ls-tree", "-z", commit, "--", rel]);
    return /^040000 tree ([0-9a-f]{40})\t/.exec(item.toString())?.[1] ?? null;
  }

  private async entries(tree: string): Promise<TreeEntry[]> {
    const rows = await this.git(["ls-tree", "-z", tree]);
    const entries: TreeEntry[] = [];
    for (const row of rows.toString().split("\0").filter(Boolean)) {
      const match = /^(\d+) (blob|tree|commit) ([0-9a-f]{40})\t([\s\S]+)$/.exec(row);
      if (!match) throw new Error(`tree ${tree} is malformed`);
      const name = match[4]!;
      if (isGitName(name)) {
        if (!this.skipped.has(name)) {
          this.skipped.add(name);
          this.log(
            `tree ${tree.slice(0, SHORT)} holds a name git refuses, left out: ${JSON.stringify(name)}`,
          );
        }
      } else
        entries.push({
          mode: match[1]!,
          type: match[2] as TreeEntry["type"],
          oid: match[3]!,
          path: name,
        });
    }
    return entries;
  }

  /** Native Git may reuse an existing loose object without looking inside. Repair only
   * unreadable data at the id just written, including loose objects left by older servers. */
  private async writeObject(write: () => Promise<Buffer>): Promise<string> {
    const oid = (await write()).toString().trim();
    if (!/^[a-f0-9]{40}$/.test(oid)) throw new Error("Git did not return a SHA-1 object id");
    const file = path.join(this.gitdir, "objects", oid.slice(0, 2), oid.slice(2));
    let bytes: Buffer;
    try {
      bytes = await fs.promises.readFile(file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return oid; // packed
      throw err;
    }
    try {
      inflateSync(bytes);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "Z_DATA_ERROR" && code !== "Z_BUF_ERROR") throw err;
      await fs.promises.unlink(file);
      if ((await write()).toString().trim() !== oid)
        throw new Error(`Could not repair Git object ${oid}`);
    }
    return oid;
  }

  private writeTree(entries: TreeEntry[]): Promise<string> {
    const records = entries.map((e) => `${e.mode} ${e.type} ${e.oid}\t${e.path}\0`).join("");
    return this.writeObject(() => this.git(["mktree", "-z"], records));
  }

  /** Writes the files' blobs and trees; returns the top tree's id. */
  private async writeFiles(files: readonly SourceFile[]): Promise<string> {
    const { here, dirs } = level(files);
    const tree: TreeEntry[] = [];
    for (const file of here) {
      const oid = await this.writeObject(() =>
        this.git(["hash-object", "-w", "--stdin"], file.body),
      );
      tree.push({ mode: "100644", path: file.rel, oid, type: "blob" });
    }
    for (const [name, inner] of dirs) {
      tree.push({ mode: "040000", path: name, oid: await this.writeFiles(inner), type: "tree" });
    }
    return this.writeTree(tree);
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
        : (await this.git(["rev-parse", `${head.commit}^{tree}`])).toString().trim();
    const next = (await this.splice(root, rel.split("/"), tree)) ?? (await this.writeTree([]));
    const date = at.toISOString();
    const env = {
      ...(await commitIdentity(this.gitdir)),
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    };
    const args = [
      "commit-tree",
      "--no-gpg-sign",
      next,
      ...(head.commit ? ["-p", head.commit] : []),
    ];
    const commit = await this.writeObject(() =>
      runGit(this.gitdir, args, { input: `${subject}\n`, env }),
    );
    await this.git(["update-ref", head.ref, commit, head.commit ?? "0".repeat(40)]);
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
    return next.length === 0 ? null : this.writeTree(next);
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
    const head = (await this.head())?.commit;
    if (!head || this.walk <= 0 || this.limit <= 0) return out;
    const log = await this.git([
      "rev-list",
      "--first-parent",
      "--timestamp",
      `--max-count=${this.walk + 1}`,
      head,
      "--",
    ]);
    const commits = log
      .toString()
      .trim()
      .split("\n")
      .map((line) => {
        const [seconds, oid] = line.split(" ") as [string, string];
        return { commit: oid, savedAt: new Date(Number(seconds) * 1000).toISOString() };
      });
    // The extra tree supplies the last walked commit's parent. Resolve all normal paths in
    // one process, including absence in old commits; a newline in the path needs argv instead.
    const trees = rel.includes("\n")
      ? await this.subtreesWithNewline(commits, rel)
      : (
          await this.git(
            ["cat-file", "--batch-check"],
            commits.map((c) => `${c.commit}:${rel}\n`).join(""),
          )
        )
          .toString()
          .trimEnd()
          .split("\n")
          .map((line) => /^([0-9a-f]{40}) tree /.exec(line)?.[1] ?? null);
    let oldest: { commit: string; savedAt: string } | undefined;
    for (const [i, commit] of commits.entries()) {
      const tree = trees[i];
      if (!tree || i === this.walk || out.length === this.limit) break;
      oldest = commit;
      if (tree !== trees[i + 1]) out.push({ tree, ...commit });
    }
    if (!out.length && oldest && trees[0]) out.push({ tree: trees[0], ...oldest });
    return out;
  }

  private async subtreesWithNewline(
    commits: { commit: string }[],
    rel: string,
  ): Promise<(string | null)[]> {
    const trees = [];
    for (const { commit } of commits) trees.push(await this.subtree(commit, rel));
    return trees;
  }

  /** Every file under a tree, paths relative to it. */
  private async readFiles(tree: string, prefix: string): Promise<SourceFile[]> {
    const out: SourceFile[] = [];
    for (const entry of await this.entries(tree)) {
      const rel = `${prefix}${entry.path}`;
      if (entry.type === "tree") out.push(...(await this.readFiles(entry.oid, `${rel}/`)));
      else if (entry.type === "blob") {
        out.push({ rel, body: await this.git(["cat-file", "blob", entry.oid]) });
      }
    }
    return out;
  }
}
