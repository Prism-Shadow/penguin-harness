/**
 * Pure-plumbing `GitEngine` / `GitRepo` over the host's Git CLI.
 *
 * Uses zero `git worktree`, isolates host `.gitconfig`, reuses a single `git cat-file --batch`
 * helper per opened `GitRepo`, hashes disk files directly via `git hash-object -w --stdin-paths`,
 * builds trees in a throwaway `GIT_INDEX_FILE` (`read-tree` + `update-index -z --index-info` +
 * `write-tree` + `commit-tree`), extracts directly via `checkout-index --prefix=<destDir>/`, and
 * advances refs atomically via `update-ref` CAS.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
import { probeGit, type GitProgram } from "./binary.js";
import { runGit, startGit } from "./git.js";

const ZERO_OID = "0".repeat(40);

function gitError(code: GitErrorCode, message: string, cause?: unknown): GitError {
  return Object.assign(new Error(message, cause !== undefined ? { cause } : undefined), { code });
}

function isHexOid(s: string): boolean {
  return /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(s);
}

function isSafeRelPath(rel: string): boolean {
  if (
    rel === "" ||
    rel.startsWith("/") ||
    rel.endsWith("/") ||
    rel.includes("\\") ||
    rel.includes("\0")
  ) {
    return false;
  }
  return rel.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

function joinPrefix(prefix: string, rel: string): string {
  if (prefix === "") return rel;
  if (rel === "") return prefix;
  return `${prefix}/${rel}`;
}

function zoneOf(offset: number): string {
  const truncated = Math.trunc(offset);
  const abs = Math.abs(truncated);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${truncated < 0 ? "-" : "+"}${hh}${mm}`;
}

interface RawTreeEntry {
  mode: string;
  name: string;
  oid: string;
}

function parseTree(oid: string, body: Buffer): RawTreeEntry[] {
  const out: RawTreeEntry[] = [];
  for (let at = 0; at < body.length; ) {
    const space = body.indexOf(0x20, at);
    const nul = space === -1 ? -1 : body.indexOf(0, space);
    if (nul === -1 || nul + 21 > body.length) {
      throw gitError("REPO_CORRUPT", `tree ${oid} is malformed`);
    }
    out.push({
      mode: body.subarray(at, space).toString("utf8"),
      name: body.subarray(space + 1, nul).toString("utf8"),
      oid: body.subarray(nul + 1, nul + 21).toString("hex"),
    });
    at = nul + 21;
  }
  return out;
}

interface RawCommit {
  tree: string;
  parents: string[];
  committerTime: number;
}

function parseCommit(oid: string, body: Buffer): RawCommit {
  const text = body.toString("utf8");
  let tree: string | undefined;
  const parents: string[] = [];
  let committerTime: number | undefined;
  for (const line of text.split("\n")) {
    if (line === "") break;
    if (line.startsWith(" ")) continue;
    const sp = line.indexOf(" ");
    const key = sp === -1 ? line : line.slice(0, sp);
    const val = sp === -1 ? "" : line.slice(sp + 1);
    if (key === "tree") tree = val;
    else if (key === "parent") parents.push(val);
    else if (key === "committer") committerTime = Number(/ (-?\d+) [+-]\d{4}$/.exec(val)?.[1]);
  }
  if (
    tree === undefined ||
    !isHexOid(tree) ||
    committerTime === undefined ||
    Number.isNaN(committerTime)
  ) {
    throw gitError("REPO_CORRUPT", `commit ${oid} is malformed`);
  }
  return { tree, parents, committerTime };
}

/** One reusable `git cat-file --batch` process per open `GitRepo` handle. */
class CatFileBatch {
  private child: ReturnType<typeof startGit> | null = null;
  private pending: Buffer[] = [];
  private waiting: Array<{
    resolve: (res: { type: string; body: Buffer } | null) => void;
    reject: (err: Error) => void;
  }> = [];
  private failed: Error | null = null;

  constructor(
    private readonly git: GitProgram,
    private readonly gitdir: string,
  ) {}

  private ensureStarted(): ReturnType<typeof startGit> {
    if (this.failed !== null) throw this.failed;
    if (this.child !== null) return this.child;
    const child = startGit(this.git, this.gitdir, ["cat-file", "--batch"]);
    this.child = child;
    child.stdout.on("data", (chunk: Buffer) => {
      this.pending.push(chunk);
      this.drain();
    });
    const stderr: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (err) => this.failAll(gitError("IO_ERROR", err.message, err)));
    child.on("close", (code, signal) => {
      this.child = null;
      if (this.waiting.length > 0) {
        const msg = Buffer.concat(stderr).toString("utf8").trim();
        this.failAll(
          gitError(
            "IO_ERROR",
            `cat-file --batch closed unexpectedly (${signal ?? code}): ${msg}`,
          ),
        );
      }
    });
    return child;
  }

  private failAll(err: Error): void {
    this.failed = err;
    for (const w of this.waiting.splice(0)) w.reject(err);
  }

  private drain(): void {
    let buf = this.pending.length === 1 ? this.pending[0]! : Buffer.concat(this.pending);
    while (this.waiting.length > 0) {
      const nl = buf.indexOf(0x0a);
      if (nl === -1) break;
      const header = buf.subarray(0, nl).toString("utf8");
      const parts = header.split(" ");
      if (parts[1] === "missing" || parts.length < 3) {
        buf = buf.subarray(nl + 1);
        this.waiting.shift()!.resolve(null);
        continue;
      }
      const type = parts[1]!;
      const len = Number(parts[2]);
      const end = nl + 1 + len;
      if (buf.length < end + 1) break;
      const body = Buffer.from(buf.subarray(nl + 1, end));
      buf = buf.subarray(end + 1);
      this.waiting.shift()!.resolve({ type, body });
    }
    this.pending = buf.length === 0 ? [] : [buf];
  }

  read(oid: string): Promise<{ type: string; body: Buffer } | null> {
    if (this.failed !== null) return Promise.reject(this.failed);
    const child = this.ensureStarted();
    return new Promise((resolve, reject) => {
      this.waiting.push({ resolve, reject });
      child.stdin.write(`${oid}\n`);
    });
  }

  async close(): Promise<void> {
    const child = this.child;
    if (child === null) return;
    this.child = null;
    await new Promise<void>((resolve) => {
      child.once("close", () => resolve());
      child.stdin.end();
    });
  }
}

async function resolveHeadFs(gitdir: string): Promise<{ ref: string; commit: string | null }> {
  let headRaw: string;
  try {
    headRaw = (await fs.readFile(path.join(gitdir, "HEAD"), "utf8")).trim();
  } catch (err) {
    throw gitError("INVALID_REF", `cannot read HEAD in ${gitdir}`, err);
  }
  const match = /^ref: (.+)$/.exec(headRaw);
  if (!match || !match[1]) {
    throw gitError("INVALID_REF", `${gitdir} has a detached or unreadable HEAD`);
  }
  const ref = match[1];
  try {
    const loose = (await fs.readFile(path.join(gitdir, ref), "utf8")).trim();
    if (!isHexOid(loose)) {
      throw gitError("INVALID_REF", `${ref} in ${gitdir} is not a commit id`);
    }
    return { ref, commit: loose };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      if ((err as GitError).code) throw err;
      throw gitError("IO_ERROR", `cannot read ${ref}`, err);
    }
  }
  let packedText: string;
  try {
    packedText = await fs.readFile(path.join(gitdir, "packed-refs"), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ref, commit: null };
    throw gitError("IO_ERROR", `cannot read packed-refs`, err);
  }
  for (const line of packedText.split("\n")) {
    if (line === "" || line.startsWith("#") || line.startsWith("^")) continue;
    const sp = line.indexOf(" ");
    if (sp === -1) continue;
    const oid = line.slice(0, sp);
    const name = line.slice(sp + 1).trim();
    if (name !== ref) continue;
    if (!isHexOid(oid)) {
      throw gitError("INVALID_REF", `${ref} in packed-refs is not a commit id`);
    }
    return { ref, commit: oid };
  }
  return { ref, commit: null };
}

function parseLsTreeZ(stdout: Buffer, withSize: boolean): GitTreeEntry[] {
  const entries: GitTreeEntry[] = [];
  let start = 0;
  while (start < stdout.length) {
    const nul = stdout.indexOf(0, start);
    if (nul === -1) break;
    const rec = stdout.subarray(start, nul);
    start = nul + 1;
    const tab = rec.indexOf(0x09);
    if (tab === -1) continue;
    const meta = rec.subarray(0, tab).toString("utf8").trim().split(/\s+/);
    const rel = rec.subarray(tab + 1).toString("utf8");
    const mode = meta[0]!;
    const type = meta[1]!;
    const oid = meta[2]!;
    if (type !== "blob") continue;
    const entry: GitTreeEntry = {
      rel,
      oid,
      mode: (mode === "100755" ? "100755" : "100644") as GitFileMode,
    };
    if (withSize && meta[3] !== undefined && meta[3] !== "-") {
      entry.size = Number(meta[3]);
    }
    entries.push(entry);
  }
  return entries;
}

function openGitclRepo(git: GitProgram, gitdir: string): GitRepo {
  let closed = false;
  const batch = new CatFileBatch(git, gitdir);

  const ensureOpen = () => {
    if (closed) throw gitError("IO_ERROR", "GitRepo has been closed");
  };

  async function subtreeOid(commitOid: string, prefix: string): Promise<string | null> {
    const obj = await batch.read(commitOid);
    if (obj === null || obj.type !== "commit") return null;
    let tree = parseCommit(commitOid, obj.body).tree;
    if (prefix === "") return tree;
    for (const seg of prefix.split("/")) {
      const tObj = await batch.read(tree);
      if (tObj === null || tObj.type !== "tree") {
        throw gitError("REPO_CORRUPT", `tree ${tree} is missing`);
      }
      const entry = parseTree(tree, tObj.body).find((e) => e.name === seg);
      if (entry === undefined || (entry.mode !== "40000" && entry.mode !== "040000")) {
        return null;
      }
      tree = entry.oid;
    }
    return tree;
  }

  async function hashCommitFiles(
    files: readonly GitCommitFile[],
  ): Promise<Array<{ rel: string; oid: string; mode: GitFileMode }>> {
    const out: Array<{ rel: string; oid: string; mode: GitFileMode }> = new Array(files.length);
    const fileItems: Array<{ idx: number; rel: string; filePath: string; mode: GitFileMode; expectedSize: number }> = [];

    for (let i = 0; i < files.length; i++) {
      const f = files[i]!;
      if (!isSafeRelPath(f.rel)) {
        throw gitError("INVALID_PATH", `unsafe path: ${f.rel}`);
      }
      const mode: GitFileMode = f.mode === "100755" ? "100755" : "100644";
      if (f.source.kind === "file") {
        let st;
        try {
          st = await fs.stat(f.source.path);
        } catch (err) {
          throw gitError("IO_ERROR", `cannot stat ${f.source.path}`, err);
        }
        fileItems.push({ idx: i, rel: f.rel, filePath: f.source.path, mode, expectedSize: st.size });
      } else {
        const res = await runGit(git, gitdir, ["hash-object", "-w", "--stdin"], {
          input: f.source.body,
        });
        out[i] = { rel: f.rel, oid: res.stdout.toString("utf8").trim(), mode };
      }
    }

    if (fileItems.length > 0) {
      // Batch all disk files in one `git hash-object -w --stdin-paths` process (zero JS heap buffering).
      const pathList = fileItems.map((item) => `${item.filePath}\n`).join("");
      let res;
      try {
        res = await runGit(git, gitdir, ["hash-object", "-w", "--stdin-paths"], {
          input: Buffer.from(pathList, "utf8"),
        });
      } catch (err) {
        throw gitError("IO_ERROR", `hash-object failed: ${(err as Error).message}`, err);
      }
      const oids = res.stdout.toString("utf8").trim().split(/\r?\n/);
      if (oids.length !== fileItems.length) {
        throw gitError("IO_ERROR", `hash-object returned ${oids.length} oids for ${fileItems.length} files`);
      }
      for (let j = 0; j < fileItems.length; j++) {
        const item = fileItems[j]!;
        const oid = oids[j]!.trim();
        const stAfter = await fs.stat(item.filePath).catch(() => null);
        if (stAfter === null || stAfter.size !== item.expectedSize) {
          throw gitError("SOURCE_CHANGED", `${item.filePath} changed during read`);
        }
        out[item.idx] = { rel: item.rel, oid, mode: item.mode };
      }
    }
    return out;
  }

  return {
    async resolveHead() {
      ensureOpen();
      return resolveHeadFs(gitdir);
    },

    async listTree(commitOid: string, prefix: string, opts?: { withSize?: boolean }): Promise<GitTreeEntry[] | null> {
      ensureOpen();
      if (!isHexOid(commitOid)) throw gitError("INVALID_OID", `invalid commit oid: ${commitOid}`);
      const tree = await subtreeOid(commitOid, prefix);
      if (tree === null) return null;
      const args = opts?.withSize ? ["ls-tree", "-r", "-l", "-z", tree] : ["ls-tree", "-r", "-z", tree];
      const res = await runGit(git, gitdir, args);
      return parseLsTreeZ(res.stdout, opts?.withSize === true);
    },

    async walkHistory(opts: GitWalkHistoryOptions): Promise<GitHistoryEntry[]> {
      ensureOpen();
      if (!isHexOid(opts.fromCommit)) {
        throw gitError("INVALID_OID", `invalid commit oid: ${opts.fromCommit}`);
      }
      const out: GitHistoryEntry[] = [];
      let oid: string | null = opts.fromCommit;
      let tree = await subtreeOid(opts.fromCommit, opts.prefix);
      const current = tree;
      let oldest: { commit: string; committerTime: number } | null = null;
      let walked = 0;

      while (oid !== null && tree !== null && out.length < opts.limit && walked < opts.maxWalk) {
        walked += 1;
        const obj = await batch.read(oid);
        if (obj === null || obj.type !== "commit") break;
        const record = parseCommit(oid, obj.body);
        oldest = { commit: oid, committerTime: record.committerTime };
        const parent = record.parents[0] ?? null;
        const before = parent === null ? null : await subtreeOid(parent, opts.prefix);
        if (before !== tree) {
          out.push({ commit: oid, tree, committerTime: record.committerTime });
        }
        oid = parent;
        tree = before;
      }
      if (out.length === 0 && current !== null && oldest !== null) {
        out.push({ commit: oldest.commit, tree: current, committerTime: oldest.committerTime });
      }
      return out;
    },

    async extractTree(opts: GitExtractTreeOptions): Promise<GitExtractTreeResult> {
      ensureOpen();
      if (!isHexOid(opts.commitOid)) {
        throw gitError("INVALID_OID", `invalid commit oid: ${opts.commitOid}`);
      }
      if (opts.prefix !== "" && !isSafeRelPath(opts.prefix)) {
        throw gitError("INVALID_PATH", `unsafe prefix: ${opts.prefix}`);
      }
      let onlySet: Set<string> | null = null;
      if (opts.onlyPaths !== undefined) {
        onlySet = new Set();
        for (const p of opts.onlyPaths) {
          if (!isSafeRelPath(p)) throw gitError("INVALID_PATH", `unsafe onlyPaths entry: ${p}`);
          onlySet.add(p);
        }
      }

      // Validate destDir is empty (or create it).
      const st = await fs.lstat(opts.destDir).catch(() => null);
      if (st !== null) {
        if (!st.isDirectory()) {
          throw gitError("DEST_NOT_EMPTY", `${opts.destDir} exists and is not a directory`);
        }
        const existing = await fs.readdir(opts.destDir);
        if (existing.length > 0) {
          throw gitError("DEST_NOT_EMPTY", `${opts.destDir} is not empty`);
        }
      } else {
        await fs.mkdir(opts.destDir, { recursive: true });
      }

      const listed = await this.listTree(opts.commitOid, opts.prefix, { withSize: true });
      if (listed === null) return { files: [], totalBytes: 0 };

      const selected = onlySet === null ? listed : listed.filter((e) => onlySet!.has(e.rel));
      for (const e of selected) {
        if (!isSafeRelPath(e.rel)) {
          throw gitError("INVALID_PATH", `tree entry has unsafe path: ${e.rel}`);
        }
      }
      if (selected.length === 0) return { files: [], totalBytes: 0 };

      const tmpIndex = path.join(os.tmpdir(), `penguin-gitcl-idx-${crypto.randomBytes(8).toString("hex")}`);
      try {
        const indexInfo = selected.map((e) => `${e.mode} ${e.oid}\t${e.rel}\0`).join("");
        await runGit(git, gitdir, ["update-index", "-z", "--index-info"], {
          input: Buffer.from(indexInfo, "utf8"),
          env: { GIT_INDEX_FILE: tmpIndex },
        });
        await runGit(git, gitdir, ["--work-tree", opts.destDir, "checkout-index", "-a", "-f"], {
          env: { GIT_INDEX_FILE: tmpIndex },
        });
      } finally {
        await fs.rm(tmpIndex, { force: true }).catch(() => undefined);
      }

      const totalBytes = selected.reduce((sum, e) => sum + (e.size ?? 0), 0);
      return { files: selected.map((e) => e.rel), totalBytes };
    },

    async commit(input: GitCommitInput): Promise<string> {
      ensureOpen();
      if (input.prefix !== "" && !isSafeRelPath(input.prefix)) {
        throw gitError("INVALID_PATH", `unsafe prefix: ${input.prefix}`);
      }
      if (input.parent !== null) {
        if (!isHexOid(input.parent)) {
          throw gitError("INVALID_OID", `invalid parent oid: ${input.parent}`);
        }
        const pObj = await batch.read(input.parent);
        if (pObj === null || pObj.type !== "commit") {
          throw gitError("PARENT_NOT_FOUND", `parent ${input.parent} is not in repository`);
        }
      }

      const tmpIndex = path.join(os.tmpdir(), `penguin-gitcl-idx-${crypto.randomBytes(8).toString("hex")}`);
      let treeOid: string;
      let commitOid: string;
      try {
        const indexEnv = { GIT_INDEX_FILE: tmpIndex };
        const loadParent =
          input.parent !== null && !(input.change.kind === "replace" && input.prefix === "");
        if (loadParent) {
          await runGit(git, gitdir, ["read-tree", input.parent!], { env: indexEnv });
        }

        const indexLines: string[] = [];
        if (input.change.kind === "replace") {
          if (loadParent && input.prefix !== "") {
            const ls = await runGit(git, gitdir, ["ls-files", "-z", "--", input.prefix], {
              env: indexEnv,
            });
            for (const p of ls.stdout.toString("utf8").split("\0")) {
              if (p !== "") indexLines.push(`0 ${ZERO_OID}\t${p}\0`);
            }
          }
          if (input.change.files !== null) {
            const hashed = await hashCommitFiles(input.change.files);
            for (const f of hashed) {
              indexLines.push(`${f.mode} ${f.oid}\t${joinPrefix(input.prefix, f.rel)}\0`);
            }
          }
        } else {
          for (const rel of input.change.remove) {
            if (!isSafeRelPath(rel)) throw gitError("INVALID_PATH", `unsafe remove path: ${rel}`);
            indexLines.push(`0 ${ZERO_OID}\t${joinPrefix(input.prefix, rel)}\0`);
          }
          const hashed = await hashCommitFiles(input.change.upsert);
          for (const f of hashed) {
            indexLines.push(`${f.mode} ${f.oid}\t${joinPrefix(input.prefix, f.rel)}\0`);
          }
        }

        if (indexLines.length > 0) {
          await runGit(git, gitdir, ["update-index", "-z", "--index-info"], {
            input: Buffer.from(indexLines.join(""), "utf8"),
            env: indexEnv,
          });
        }

        const wt = await runGit(git, gitdir, ["write-tree"], { env: indexEnv });
        treeOid = wt.stdout.toString("utf8").trim();

        const when = `@${Math.trunc(input.when.seconds)} ${zoneOf(input.when.offset)}`;
        const commitArgs =
          input.parent !== null
            ? ["commit-tree", treeOid, "-p", input.parent]
            : ["commit-tree", treeOid];
        const ct = await runGit(git, gitdir, commitArgs, {
          input: Buffer.from(input.message, "utf8"),
          env: {
            GIT_AUTHOR_NAME: input.author.name,
            GIT_AUTHOR_EMAIL: input.author.email,
            GIT_AUTHOR_DATE: when,
            GIT_COMMITTER_NAME: input.committer.name,
            GIT_COMMITTER_EMAIL: input.committer.email,
            GIT_COMMITTER_DATE: when,
          },
        });
        commitOid = ct.stdout.toString("utf8").trim();
      } finally {
        await fs.rm(tmpIndex, { force: true }).catch(() => undefined);
      }

      if (input.beforeMoveRef !== undefined) {
        await input.beforeMoveRef({ commit: commitOid, tree: treeOid });
      }

      const expectedOld = input.parent ?? ZERO_OID;
      const upd = await runGit(git, gitdir, ["update-ref", input.ref, commitOid, expectedOld], {
        allowNonZero: true,
      });
      if (upd.status !== 0) {
        throw gitError(
          "CAS_CONFLICT",
          `ref update refused for ${input.ref}: ${upd.stderr || `exit ${upd.status}`}`,
        );
      }
      return commitOid;
    },

    async close(): Promise<void> {
      closed = true;
      await batch.close();
    },
  };
}

export function gitclGitEngine(git: GitProgram, version: string): GitEngine {
  return {
    name: `git ${version} (cli plumbing)`,
    async open(gitdir: string): Promise<GitRepo> {
      try {
        await fs.stat(path.join(gitdir, "HEAD"));
      } catch (err) {
        throw gitError("IO_ERROR", `cannot open bare repository ${gitdir}`, err);
      }
      return openGitclRepo(git, gitdir);
    },
  };
}

export async function openGitclGitEngine(host: GitEngineHost): Promise<GitEngine> {
  const say = (line: string) => host.log(`[agent-state-gitcl] ${line}`);
  const found = await probeGit();
  if (found === null) {
    throw new Error("no git on this host's PATH");
  }
  say(`git ${found.version} from the PATH (plumbing)`);
  return gitclGitEngine(found.git, found.version);
}
