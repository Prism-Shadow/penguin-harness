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
 * Writes to one repository run one at a time in this process, whichever instance makes them.
 * Reads take no lock: objects never change once written, and the branch ref is replaced whole.
 *
 * What is cheap in-process always runs here: HEAD and the refs, the trees, whether a load
 * changed anything, the history walk, creating the repository, and which names git refuses —
 * trees and commits are parsed in this file, from the raw objects an engine reads. The two steps
 * whose cost grows with the files — writing one commit, and reading objects back — go to an
 * ENGINE (`AgentStateEngine`, core's plugin contract). There is no built-in one: a deployment
 * contributes an engine (./engines.ts), and the first that is ready does every step. A
 * repository reached with no engine ready is an error, so the absence is loud, never a silent
 * fallback. Every engine writes the same bytes, so the same input is the same commit under any
 * of them.
 *
 * Who a version is by comes from ./git-identity.ts: the member who asked for it, else the
 * server's Git identity, read the way git reads it.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
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

// The git-reserved name check is shared with the agent domain's State paths (its vocabulary
// module owns it); imported for this module's own checks and re-exported for repo's consumers.
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

/** A commit's headers as git stores them: the tree, the first parents, the committer's whole seconds. */
interface RawCommit {
  tree: string;
  parents: string[];
  committerTime: number;
}

/** A commit object's headers, parsed here: `tree`, every `parent`, the committer's time. */
function parseCommit(id: string, body: Uint8Array): RawCommit {
  const text = Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString("utf8");
  let tree: string | undefined;
  const parents: string[] = [];
  let committerTime: number | undefined;
  for (const line of text.split("\n")) {
    if (line === "") break; // the headers end; the message follows
    if (line.startsWith(" ")) continue; // a continuation line (a gpgsig), not a header of its own
    const space = line.indexOf(" ");
    const key = space === -1 ? line : line.slice(0, space);
    const value = space === -1 ? "" : line.slice(space + 1);
    if (key === "tree") tree = value;
    else if (key === "parent") parents.push(value);
    else if (key === "committer")
      committerTime = Number(/ (\d+) [+-]\d{4}$/.exec(value)?.[1]);
  }
  if (!/^[0-9a-f]{40}$/.test(tree ?? "") || committerTime === undefined || Number.isNaN(committerTime))
    throw new Error(`${id} is not a commit`);
  return { tree, parents, committerTime };
}

export class AgentStateRepo {
  private readonly gitdir: string;
  private readonly now: () => Date;
  private readonly log: (line: string) => void;
  private readonly limit: number;
  private readonly walk: number;
  private readonly identity: IdentitySources;
  /** The engine that writes commits and reads objects back; contributed, never a built-in one. */
  private readonly engine: AgentStateEngine;
  /** Refused tree entry names already logged by this instance. */
  private readonly skipped = new Set<string>();

  /**
   * `caps` lowers HISTORY_LIMIT and HISTORY_WALK (tests). `engine` is the deployment's
   * contributed engine (./engines.ts); with none ready, constructing the repository is an error.
   * `identity` is where the server's Git identity is read from: the process's environment and
   * home unless given.
   */
  constructor(opts: {
    gitdir: string;
    now: () => Date;
    log: (line: string) => void;
    caps?: { versions?: number; commits?: number };
    engine: AgentStateEngine;
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
      const head = (await this.head()) ?? (await this.create());
      if (head.commit !== null) {
        const tree = await this.subtree(head.commit, rel);
        if (tree !== null && (await this.holdsExactly(tree, kept))) {
          return { commit: head.commit.slice(0, SHORT), changed: false };
        }
      }
      const commit = await this.engine.commit(
        this.commitOf(head, rel, kept, subject, opts.at ?? this.now(), opts.by),
      );
      return { commit: commit.slice(0, SHORT), changed: true };
    });
  }

  /**
   * Commits a tree without `rel`; nothing when HEAD lacks it (or there is no repository).
   * A few trees and a commit, through the engine like any write.
   */
  removePath(rel: string, subject: string, opts: { by?: VersionAuthor } = {}): Promise<void> {
    return this.serial(async () => {
      const head = await this.head();
      if (head === null || head.commit === null) return;
      if ((await this.subtree(head.commit, rel)) === null) return;
      await this.engine.commit(this.commitOf(head, rel, null, subject, this.now(), opts.by));
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
    const bodies = await this.engine.readObjects(this.gitdir, oids);
    const byOid = new Map<string, Uint8Array>();
    for (const [i, oid] of oids.entries()) {
      const body = bodies[i];
      if (body === null || body === undefined)
        throw new Error(`object ${oid} is not in the repository`);
      byOid.set(oid, body);
    }
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

  /** Whether a tree holds exactly these files, and nothing besides: an unchanged load. */
  private async holdsExactly(tree: string, files: SourceFile[]): Promise<boolean> {
    const listed = await this.listFiles(tree, "");
    if (listed.length !== files.length) return false;
    const want = new Map(files.map((f) => [f.rel, blobOid(f.body)] as const));
    return listed.every((f) => want.get(f.rel) === f.oid);
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

  /**
   * The branch HEAD names and its commit (null before the first one); null when there is no
   * repository. A detached or unreadable HEAD, or a branch ref that is not a commit id, is an
   * error: no version is recorded or listed against it. Refs are the repository's files: a
   * branch with no file of its own is read from `packed-refs` (a person's git packed it), and
   * with neither, it is a branch with no commit yet.
   */
  private async head(): Promise<{ ref: string; commit: string | null } | null> {
    try {
      await fs.promises.lstat(this.gitdir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
    const head = (await fs.promises.readFile(path.join(this.gitdir, "HEAD"), "utf8")).trim();
    const ref = /^ref: (.+)$/.exec(head)?.[1];
    if (ref === undefined || ref === "") throw new Error(`${this.gitdir} has a detached HEAD`);
    let loose: string;
    try {
      loose = (await fs.promises.readFile(path.join(this.gitdir, ref), "utf8")).trim();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      return { ref, commit: await this.packed(ref) };
    }
    if (!/^[0-9a-f]{40}$/.test(loose))
      throw new Error(`${ref} in ${this.gitdir} is not a commit id`);
    return { ref, commit: loose };
  }

  /** A ref's commit from `packed-refs`; null when it is not there. */
  private async packed(ref: string): Promise<string | null> {
    let text: string;
    try {
      text = await fs.promises.readFile(path.join(this.gitdir, "packed-refs"), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
    for (const line of text.split("\n")) {
      if (line === "" || line.startsWith("#") || line.startsWith("^")) continue;
      const space = line.indexOf(" ");
      // A line is `<oid> SP <ref>`: the commit first, the name it is under second.
      const [commit, name] = [line.slice(0, space), line.slice(space + 1)];
      if (name !== ref) continue;
      if (!/^[0-9a-f]{40}$/.test(commit))
        throw new Error(`${ref} in ${this.gitdir} is not a commit id`);
      return commit;
    }
    return null;
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
    // What a bare repository is: the object store, the refs, HEAD, a config, the excludes.
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
    return { ref: `refs/heads/${BRANCH}`, commit: null };
  }

  /**
   * The id of the tree at `rel` in a commit; null when the commit has nothing there, or is not
   * in the repository at all (the parent of a shallow copy's oldest commit).
   */
  private async subtree(commit: string, rel: string): Promise<string | null> {
    const record = await this.commitAt(commit);
    if (record === null) return null;
    let tree = record.tree;
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

  /** A commit object's headers, read off the engine; null when the id is not in the repository. */
  private async commitAt(id: string): Promise<RawCommit | null> {
    const body = await this.readObject(id);
    if (body === null) return null;
    return parseCommit(id, body);
  }

  /** A tree's entries, read here (see entriesOf). */
  private async entries(tree: string): Promise<RawEntry[]> {
    const body = await this.readObject(tree);
    if (body === null) throw new Error(`object ${tree} is not in the repository`);
    return this.entriesOf(tree, body);
  }

  /** One raw object off the engine; null when the id is not in the repository. */
  private async readObject(id: string): Promise<Uint8Array | null> {
    const [body] = await this.engine.readObjects(this.gitdir, [id]);
    return body ?? null;
  }

  /**
   * A tree's entries, parsed here rather than by a library, which refuses a whole tree for one
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
      const record = await this.commitAt(oid);
      if (record === null) break;
      const savedAt = new Date(record.committerTime * 1000).toISOString();
      oldest = { commit: oid, savedAt };
      const parent = record.parents[0] ?? null;
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
