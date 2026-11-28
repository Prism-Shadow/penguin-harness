/**
 * Pure-plumbing Git CLI `GitEngine` / `GitRepo` implementation.
 *
 * Uses canonical Git plumbing (no hand-rolled HEAD/packed-refs/binary-tree/commit parsers):
 * - `resolveHead`: `git symbolic-ref HEAD` + `git rev-parse --verify --quiet <ref>^{commit}`
 * - `listTree`: `git ls-tree -z -r [-l]`
 * - `walkHistory`: `git rev-list --first-parent --format=...` + exact subtree OID lookup
 * - `extractTree`: `git ls-tree -z -r` + raw blob read via hardened `cat-file --batch` + exclusive `wx` write
 * - `commit`: `git hash-object -w --no-filters` + private `mkdtemp` index + `update-index --replace -z --index-info`
 *   + `write-tree` + `commit-tree` (`@<seconds> <tz>`) + atomic `update-ref` CAS
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type {
  GitCommitFile,
  GitCommitInput,
  GitEngine,
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
import type { GitProgram } from "./binary.js";
import { runGit, startGit } from "./plumbing-git.js";

const ZERO_OID = "0".repeat(40);
const OID_RE = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;
const WIN_DEVICE_RE = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i;
const UTF8_STRICT = new TextDecoder("utf-8", { fatal: true });

function gitError(code: GitErrorCode, message: string): GitError {
  return Object.assign(new Error(message), { code });
}

function isSafeRelPath(rel: string): boolean {
  if (
    rel === "" ||
    rel.startsWith("/") ||
    rel.endsWith("/") ||
    rel.includes("\\") ||
    rel.includes("\0") ||
    rel.includes(":")
  ) {
    return false;
  }
  return rel
    .split("/")
    .every((seg) => seg !== "" && seg !== "." && seg !== ".." && !WIN_DEVICE_RE.test(seg));
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

/** Git C-quoting for line-oriented plumbing stdin protocols (`hash-object --stdin-paths`). */
function cQuotePath(p: string): string {
  const buf = Buffer.from(p, "utf8");
  let out = '"';
  for (const byte of buf) {
    if (byte === 0x22) out += '\\"';
    else if (byte === 0x5c) out += "\\\\";
    else if (byte === 0x0a) out += "\\n";
    else if (byte === 0x0d) out += "\\r";
    else if (byte === 0x09) out += "\\t";
    else if (byte < 0x20 || byte === 0x7f) out += `\\${byte.toString(8).padStart(3, "0")}`;
    else out += String.fromCharCode(byte);
  }
  return Buffer.from(`${out}"`, "latin1").toString("utf8");
}

function decodeStrictUtf8(buf: Buffer, context: string): string {
  try {
    return UTF8_STRICT.decode(buf);
  } catch {
    throw gitError("INVALID_PATH", `non-UTF-8 entry name in ${context}`);
  }
}

interface BatchReply {
  oid: string;
  type: string;
  size: number;
  body: Buffer;
}

interface BatchWaiter {
  expectedOid: string;
  resolve: (v: BatchReply | null) => void;
  reject: (err: Error) => void;
}

interface BatchGen {
  id: number;
  child: ChildProcessWithoutNullStreams;
  queue: BatchWaiter[];
  chunks: Buffer[];
  bufferedLen: number;
  header: { oid: string; type: string; size: number } | null;
  retired: boolean;
}

/**
 * Generation-isolated persistent `git cat-file --batch` reader.
 * - Handles `stdin` `EPIPE` errors without crashing Node.
 * - Uses generation tokens so an old closing child can never clear or fail a newer generation.
 * - Strictly validates `<oid> <type> <size>\n`, exact body length, and trailing `\n`.
 * - Recovers cleanly on subsequent requests after a transient helper crash while repo is open.
 */
class BatchCatFile {
  private gen: BatchGen | null = null;
  private nextGenId = 1;
  private closed = false;
  private readonly git: GitProgram;
  private readonly gitdir: string;

  constructor(git: GitProgram, gitdir: string) {
    this.git = git;
    this.gitdir = gitdir;
  }

  private retire(g: BatchGen, err: Error): void {
    if (g.retired) return;
    g.retired = true;
    if (this.gen === g) {
      this.gen = null;
    }
    const pending = g.queue.splice(0);
    g.chunks.length = 0;
    g.bufferedLen = 0;
    g.header = null;
    try {
      g.child.stdin.destroy();
    } catch {
      // ignore
    }
    try {
      g.child.kill();
    } catch {
      // ignore
    }
    for (const w of pending) w.reject(err);
  }

  private ensure(): BatchGen {
    if (this.closed) throw gitError("IO_ERROR", "GitRepo has been closed");
    if (this.gen && !this.gen.retired) return this.gen;

    const child = startGit(this.git, this.gitdir, ["cat-file", "--batch"]);
    const g: BatchGen = {
      id: this.nextGenId++,
      child,
      queue: [],
      chunks: [],
      bufferedLen: 0,
      header: null,
      retired: false,
    };
    this.gen = g;

    child.stdout.on("data", (chunk: Buffer) => {
      if (g.retired) return;
      g.chunks.push(chunk);
      g.bufferedLen += chunk.length;
      this.drain(g);
    });
    child.stderr.resume();
    child.stdin.on("error", (err: NodeJS.ErrnoException) => {
      this.retire(g, gitError("IO_ERROR", `git cat-file stdin error: ${err.code ?? err.message}`));
    });
    child.on("error", (err) => {
      this.retire(g, gitError("IO_ERROR", `git cat-file error: ${err.message}`));
    });
    child.on("close", (code, signal) => {
      this.retire(
        g,
        gitError("IO_ERROR", `git cat-file exited unexpectedly (${signal ?? code ?? "eof"})`),
      );
    });
    return g;
  }

  private consume(g: BatchGen, n: number): Buffer {
    if (n === 0) return Buffer.alloc(0);
    const merged = g.chunks.length === 1 ? g.chunks[0]! : Buffer.concat(g.chunks, g.bufferedLen);
    const out = merged.subarray(0, n);
    const rest = merged.subarray(n);
    g.chunks = rest.length > 0 ? [rest] : [];
    g.bufferedLen = rest.length;
    return out;
  }

  private findNewline(g: BatchGen): number {
    let offset = 0;
    for (const c of g.chunks) {
      const idx = c.indexOf(0x0a);
      if (idx !== -1) return offset + idx;
      offset += c.length;
    }
    return -1;
  }

  private drain(g: BatchGen): void {
    while (!g.retired && g.queue.length > 0) {
      if (g.header === null) {
        const nl = this.findNewline(g);
        if (nl === -1) {
          if (g.bufferedLen > 4096) {
            this.retire(g, gitError("REPO_CORRUPT", "oversized cat-file header line"));
          }
          return;
        }
        const line = this.consume(g, nl + 1)
          .subarray(0, nl)
          .toString("utf8");
        const waiter = g.queue[0]!;
        if (line === `${waiter.expectedOid} missing` || line.endsWith(" missing")) {
          g.queue.shift()!.resolve(null);
          continue;
        }
        const parts = line.split(" ");
        if (parts.length !== 3) {
          this.retire(g, gitError("REPO_CORRUPT", `malformed cat-file header: ${line}`));
          return;
        }
        const [oid, type, sizeStr] = parts;
        const size = Number(sizeStr);
        if (!OID_RE.test(oid!) || !Number.isSafeInteger(size) || size < 0) {
          this.retire(g, gitError("REPO_CORRUPT", `invalid cat-file header: ${line}`));
          return;
        }
        g.header = { oid: oid!, type: type!, size };
      }

      const need = g.header.size + 1;
      if (g.bufferedLen < need) return;
      const frame = this.consume(g, need);
      if (frame[g.header.size] !== 0x0a) {
        this.retire(g, gitError("REPO_CORRUPT", "cat-file body missing trailing LF"));
        return;
      }
      const body = Buffer.from(frame.subarray(0, g.header.size));
      const { oid, type, size } = g.header;
      g.header = null;
      g.queue.shift()!.resolve({ oid, type, size, body });
    }
  }

  read(oid: string): Promise<BatchReply | null> {
    return new Promise((resolve, reject) => {
      let g: BatchGen;
      try {
        g = this.ensure();
      } catch (err) {
        reject(err);
        return;
      }
      g.queue.push({ expectedOid: oid, resolve, reject });
      try {
        g.child.stdin.write(`${oid}\n`, (err) => {
          if (err) {
            this.retire(g, gitError("IO_ERROR", `git cat-file write failed: ${err.message}`));
          }
        });
      } catch (err) {
        this.retire(g, gitError("IO_ERROR", `git cat-file write failed: ${String(err)}`));
      }
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    const g = this.gen;
    this.gen = null;
    if (!g || g.retired) return;
    g.retired = true;
    const pending = g.queue.splice(0);
    for (const w of pending) w.reject(gitError("IO_ERROR", "GitRepo closed"));
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        try {
          g.child.kill("SIGKILL");
        } catch {
          // ignore
        }
        done();
      }, 2000);
      g.child.once("close", done);
      try {
        g.child.stdin.end();
      } catch {
        try {
          g.child.kill();
        } catch {
          // ignore
        }
        done();
      }
    });
  }
}

/** Parse `git ls-tree -z -r` (or `-z -r -l`) binary output strictly. */
function parseLsTreeZ(stdout: Buffer, withSize: boolean, prefix: string): GitTreeEntry[] {
  const entries: GitTreeEntry[] = [];
  let pos = 0;
  const stripPrefix = prefix === "" ? "" : `${prefix}/`;

  while (pos < stdout.length) {
    const nul = stdout.indexOf(0, pos);
    if (nul === -1) {
      throw gitError("REPO_CORRUPT", "unterminated record in git ls-tree -z");
    }
    const record = stdout.subarray(pos, nul);
    pos = nul + 1;
    if (record.length === 0) continue;

    const tab = record.indexOf(0x09);
    if (tab === -1) {
      throw gitError("REPO_CORRUPT", "missing tab separator in git ls-tree -z");
    }
    const meta = record.subarray(0, tab).toString("ascii").trim().split(/\s+/);
    const fullPath = decodeStrictUtf8(record.subarray(tab + 1), "ls-tree");
    const rel =
      stripPrefix === ""
        ? fullPath
        : fullPath.startsWith(stripPrefix)
          ? fullPath.slice(stripPrefix.length)
          : fullPath;

    const modeRaw = meta[0] ?? "";
    const type = meta[1] ?? "";
    const oid = meta[2] ?? "";
    if (type !== "blob") continue;
    if (!OID_RE.test(oid)) {
      throw gitError("REPO_CORRUPT", `invalid oid in ls-tree: ${oid}`);
    }
    const mode: GitFileMode = modeRaw === "100755" ? "100755" : "100644";
    const entry: GitTreeEntry = { rel, oid, mode };
    if (withSize) {
      const sz = Number(meta[3]);
      if (!Number.isSafeInteger(sz) || sz < 0) {
        throw gitError("REPO_CORRUPT", `invalid blob size in ls-tree: ${meta[3]}`);
      }
      entry.size = sz;
    }
    entries.push(entry);
  }
  return entries;
}

async function openPlumbingRepo(git: GitProgram, gitdir: string): Promise<GitRepo> {
  // Verify repository via canonical `git rev-parse --git-dir`
  const probe = await runGit(git, gitdir, ["rev-parse", "--git-dir"], { allowNonZero: true });
  if (probe.status !== 0) {
    throw gitError("IO_ERROR", `cannot open git repository ${gitdir}: ${probe.stderr}`);
  }

  const batch = new BatchCatFile(git, gitdir);
  let closing = false;
  let closed = false;
  let inFlight = 0;
  let hookDepth = 0;
  let closePromise: Promise<void> | null = null;
  const drainWaiters: Array<() => void> = [];

  const notifyDrained = () => {
    if (inFlight === 0 && drainWaiters.length > 0) {
      const list = drainWaiters.splice(0);
      for (const r of list) r();
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

  async function resolveSubtreeOid(commitOid: string, prefix: string): Promise<string | null> {
    const rev = prefix === "" ? `${commitOid}^{tree}` : `${commitOid}:${prefix}`;
    const r = await runGit(git, gitdir, ["rev-parse", "--verify", "--quiet", rev], {
      allowNonZero: true,
    });
    if (r.status !== 0) return null;
    const oid = r.stdout.toString("ascii").trim();
    if (!OID_RE.test(oid)) return null;
    const t = await runGit(git, gitdir, ["cat-file", "-t", oid], { allowNonZero: true });
    if (t.status !== 0) return null;
    return t.stdout.toString("ascii").trim() === "tree" ? oid : null;
  }

  async function listTreeInternal(
    commitOid: string,
    prefix: string,
    opts?: { withSize?: boolean },
  ): Promise<GitTreeEntry[] | null> {
    if (!OID_RE.test(commitOid)) throw gitError("INVALID_OID", `invalid commit oid: ${commitOid}`);
    if (prefix !== "" && !isSafeRelPath(prefix)) {
      throw gitError("INVALID_PATH", `unsafe prefix: ${prefix}`);
    }
    // Verify commit exists & is a commit object
    const verify = await runGit(
      git,
      gitdir,
      ["rev-parse", "--verify", "--quiet", `${commitOid}^{commit}`],
      {
        allowNonZero: true,
      },
    );
    if (verify.status !== 0) return null;

    const treeOid = await resolveSubtreeOid(commitOid, prefix);
    if (treeOid === null) return null;

    const withSize = opts?.withSize === true;
    const args = withSize
      ? ["ls-tree", "-z", "-r", "-l", treeOid]
      : ["ls-tree", "-z", "-r", treeOid];
    const ls = await runGit(git, gitdir, args, { allowNonZero: true });
    if (ls.status !== 0) {
      throw gitError("REPO_CORRUPT", `git ls-tree failed on ${treeOid}: ${ls.stderr}`);
    }
    return parseLsTreeZ(ls.stdout, withSize, "");
  }

  async function hashCommitFiles(
    files: readonly GitCommitFile[],
  ): Promise<Array<{ rel: string; oid: string; mode: GitFileMode }>> {
    for (const f of files) {
      if (!isSafeRelPath(f.rel)) throw gitError("INVALID_PATH", `unsafe file path: ${f.rel}`);
    }

    const results: Array<{ rel: string; oid: string; mode: GitFileMode } | undefined> = new Array(
      files.length,
    );
    const diskIndices: number[] = [];
    const diskStats: Array<{
      path: string;
      dev: number;
      ino: number;
      size: number;
      mtimeMs: number;
    }> = [];

    for (let i = 0; i < files.length; i += 1) {
      const f = files[i]!;
      const mode: GitFileMode = f.mode ?? "100644";
      if (f.source.kind === "file") {
        let st;
        try {
          st = await fs.lstat(f.source.path);
        } catch (err) {
          throw gitError("IO_ERROR", `cannot stat ${f.source.path}: ${(err as Error).message}`);
        }
        if (!st.isFile()) {
          throw gitError("INVALID_PATH", `source path is not a regular file: ${f.source.path}`);
        }
        diskIndices.push(i);
        diskStats.push({
          path: f.source.path,
          dev: st.dev,
          ino: st.ino,
          size: st.size,
          mtimeMs: st.mtimeMs,
        });
      } else {
        const res = await runGit(git, gitdir, ["hash-object", "-w", "--no-filters", "--stdin"], {
          input: f.source.body,
        });
        results[i] = { rel: f.rel, oid: res.stdout.toString("ascii").trim(), mode };
      }
    }

    if (diskIndices.length > 0) {
      // Pass C-quoted paths with `--no-filters` so newlines in filenames and .gitattributes never corrupt blobs.
      const stdinPaths = diskStats.map((s) => `${cQuotePath(s.path)}\n`).join("");
      const res = await runGit(
        git,
        gitdir,
        ["hash-object", "-w", "--no-filters", "--stdin-paths"],
        {
          input: Buffer.from(stdinPaths, "utf8"),
        },
      );
      const oids = res.stdout.toString("ascii").trim().split(/\r?\n/).filter(Boolean);
      if (oids.length !== diskIndices.length) {
        throw gitError(
          "IO_ERROR",
          `hash-object returned ${oids.length} oids for ${diskIndices.length} files`,
        );
      }
      for (let j = 0; j < diskIndices.length; j += 1) {
        const before = diskStats[j]!;
        let after;
        try {
          after = await fs.lstat(before.path);
        } catch (err) {
          throw gitError(
            "SOURCE_CHANGED",
            `source disappeared during hash: ${before.path} (${String(err)})`,
          );
        }
        if (
          !after.isFile() ||
          after.dev !== before.dev ||
          after.ino !== before.ino ||
          after.size !== before.size ||
          after.mtimeMs !== before.mtimeMs
        ) {
          throw gitError("SOURCE_CHANGED", `source file changed during read: ${before.path}`);
        }
        const idx = diskIndices[j]!;
        const f = files[idx]!;
        results[idx] = { rel: f.rel, oid: oids[j]!, mode: f.mode ?? "100644" };
      }
    }

    return results as Array<{ rel: string; oid: string; mode: GitFileMode }>;
  }

  return {
    resolveHead() {
      return runAdmitted(async () => {
        // Canonical symbolic-ref resolution (handles chains, loose refs, packed-refs, and reftable).
        const sym = await runGit(git, gitdir, ["symbolic-ref", "HEAD"], { allowNonZero: true });
        if (sym.status !== 0) {
          throw gitError(
            "INVALID_REF",
            `${gitdir} has a detached or unreadable HEAD: ${sym.stderr}`,
          );
        }
        const ref = sym.stdout.toString("utf8").trim();
        if (!ref) {
          throw gitError("INVALID_REF", `${gitdir} has an empty HEAD symbolic ref`);
        }

        const check = await runGit(
          git,
          gitdir,
          ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
          {
            allowNonZero: true,
          },
        );
        if (check.status === 0) {
          const oid = check.stdout.toString("ascii").trim();
          if (!OID_RE.test(oid)) {
            throw gitError("INVALID_REF", `${ref} in ${gitdir} is not a commit id`);
          }
          return { ref, commit: oid };
        }

        // Distinguish unborn branch (ref absent) from corrupt/non-commit ref (ref exists in show-ref or on disk).
        const show = await runGit(git, gitdir, ["show-ref", "--verify", "--quiet", ref], {
          allowNonZero: true,
        });
        if (show.status === 0) {
          throw gitError("INVALID_REF", `${ref} in ${gitdir} is not a commit id`);
        }
        // Also check for an empty/corrupt loose ref file (show-ref returns non-zero on empty loose ref).
        const loose = await fs.lstat(path.join(gitdir, ...ref.split("/"))).catch(() => null);
        if (loose !== null) {
          throw gitError("INVALID_REF", `${ref} in ${gitdir} is not a commit id`);
        }
        return { ref, commit: null };
      });
    },

    listTree(commitOid: string, prefix: string, opts?: { withSize?: boolean }) {
      return runAdmitted(() => listTreeInternal(commitOid, prefix, opts));
    },

    walkHistory(opts: GitWalkHistoryOptions): Promise<GitHistoryEntry[]> {
      return runAdmitted(async () => {
        if (!OID_RE.test(opts.fromCommit)) {
          throw gitError("INVALID_OID", `invalid fromCommit oid: ${opts.fromCommit}`);
        }
        if (opts.prefix !== "" && !isSafeRelPath(opts.prefix)) {
          throw gitError("INVALID_PATH", `unsafe prefix: ${opts.prefix}`);
        }
        const limit = Math.max(0, Math.trunc(opts.limit));
        const maxWalk = Math.max(0, Math.trunc(opts.maxWalk));
        if (limit === 0 || maxWalk === 0) return [];

        const startTree = await resolveSubtreeOid(opts.fromCommit, opts.prefix);
        if (startTree === null) return [];

        // Fetch first-parent chain metadata via canonical `git rev-list` (maxWalk + 1 to inspect last commit's parent).
        const rl = await runGit(
          git,
          gitdir,
          [
            "rev-list",
            "--first-parent",
            `--max-count=${maxWalk + 1}`,
            "--format=%H %ct",
            "--no-commit-header",
            opts.fromCommit,
          ],
          { allowNonZero: true },
        );
        if (rl.status !== 0) {
          throw gitError("REPO_CORRUPT", `git rev-list failed: ${rl.stderr}`);
        }
        const chain: Array<{ commit: string; committerTime: number }> = [];
        for (const line of rl.stdout.toString("ascii").split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const [commit, ctStr] = trimmed.split(" ");
          const committerTime = Number(ctStr);
          if (!commit || !OID_RE.test(commit) || !Number.isSafeInteger(committerTime)) {
            throw gitError("REPO_CORRUPT", `malformed rev-list line: ${trimmed}`);
          }
          chain.push({ commit, committerTime });
        }

        const out: GitHistoryEntry[] = [];
        let currTree: string | null = startTree;
        let oldest: { commit: string; committerTime: number } | null = null;
        const steps = Math.min(maxWalk, chain.length);

        for (let i = 0; i < steps && currTree !== null && out.length < limit; i += 1) {
          const item = chain[i]!;
          oldest = item;
          const nextCommit = chain[i + 1]?.commit ?? null;
          const beforeTree =
            nextCommit !== null ? await resolveSubtreeOid(nextCommit, opts.prefix) : null;
          if (beforeTree !== currTree) {
            out.push({
              commit: item.commit,
              tree: currTree,
              committerTime: item.committerTime,
            });
          }
          currTree = beforeTree;
        }

        if (out.length === 0 && oldest !== null) {
          out.push({
            commit: oldest.commit,
            tree: startTree,
            committerTime: oldest.committerTime,
          });
        }
        return out;
      });
    },

    extractTree(opts: GitExtractTreeOptions): Promise<GitExtractTreeResult> {
      return runAdmitted(async () => {
        if (!OID_RE.test(opts.commitOid)) {
          throw gitError("INVALID_OID", `invalid commitOid: ${opts.commitOid}`);
        }
        if (opts.prefix !== "" && !isSafeRelPath(opts.prefix)) {
          throw gitError("INVALID_PATH", `unsafe prefix: ${opts.prefix}`);
        }
        let filterSet: Set<string> | null = null;
        if (opts.onlyPaths !== undefined) {
          filterSet = new Set();
          for (const p of opts.onlyPaths) {
            if (!isSafeRelPath(p)) throw gitError("INVALID_PATH", `unsafe onlyPath: ${p}`);
            filterSet.add(p);
          }
        }

        // Validate destination directory without following symlinks.
        let destStat = null;
        try {
          destStat = await fs.lstat(opts.destDir);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
            throw gitError("IO_ERROR", `cannot lstat ${opts.destDir}: ${(err as Error).message}`);
          }
        }
        if (destStat !== null) {
          if (!destStat.isDirectory()) {
            throw gitError("DEST_NOT_EMPTY", `${opts.destDir} exists and is not a real directory`);
          }
          const existing = await fs.readdir(opts.destDir);
          if (existing.length > 0) {
            throw gitError("DEST_NOT_EMPTY", `${opts.destDir} is not empty`);
          }
        } else {
          await fs.mkdir(opts.destDir, { recursive: true });
        }

        const listed = await listTreeInternal(opts.commitOid, opts.prefix, { withSize: false });
        if (listed === null || listed.length === 0) {
          return { files: [], totalBytes: 0 };
        }
        const selected = filterSet === null ? listed : listed.filter((e) => filterSet!.has(e.rel));
        if (selected.length === 0) {
          return { files: [], totalBytes: 0 };
        }

        // Extract raw blob bytes directly (never runs checkout/eol filters!) with exclusive `wx` writes.
        const files: string[] = [];
        let totalBytes = 0;
        for (const entry of selected) {
          if (!isSafeRelPath(entry.rel)) {
            throw gitError("INVALID_PATH", `unsafe tree entry path: ${entry.rel}`);
          }
          const obj = await batch.read(entry.oid);
          if (obj === null || obj.type !== "blob") {
            throw gitError(
              "REPO_CORRUPT",
              `missing or non-blob object ${entry.oid} for ${entry.rel}`,
            );
          }
          const target = path.join(opts.destDir, ...entry.rel.split("/"));
          await fs.mkdir(path.dirname(target), { recursive: true });
          const fh = await fs.open(target, "wx", entry.mode === "100755" ? 0o777 : 0o666);
          try {
            await fh.writeFile(obj.body);
          } finally {
            await fh.close();
          }
          totalBytes += obj.body.length;
          files.push(entry.rel);
        }

        return { files, totalBytes };
      });
    },

    commit(input: GitCommitInput): Promise<string> {
      return runAdmitted(async () => {
        if (input.parent !== null && !OID_RE.test(input.parent)) {
          throw gitError("INVALID_OID", `invalid parent oid: ${input.parent}`);
        }
        if (input.prefix !== "" && !isSafeRelPath(input.prefix)) {
          throw gitError("INVALID_PATH", `unsafe prefix: ${input.prefix}`);
        }
        if (!input.ref.startsWith("refs/")) {
          throw gitError("INVALID_REF", `invalid ref name: ${input.ref}`);
        }
        if (!Number.isFinite(input.when.seconds) || input.when.seconds < 0) {
          throw gitError("INVALID_PATH", `invalid commit timestamp: ${input.when.seconds}`);
        }

        // Private per-commit directory for GIT_INDEX_FILE so `.lock` leftovers are always cleaned.
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-gitcl-idx-"));
        const tmpIndex = path.join(tmpDir, "index");
        const indexEnv: NodeJS.ProcessEnv = { GIT_INDEX_FILE: tmpIndex };
        let treeOid: string;
        let commitOid: string;

        try {
          if (input.parent !== null) {
            const parentObj = await batch.read(input.parent);
            if (parentObj === null) {
              throw gitError("PARENT_NOT_FOUND", `parent ${input.parent} is not in repository`);
            }
            if (parentObj.type !== "commit") {
              throw gitError(
                "INVALID_OID",
                `parent ${input.parent} is not a commit (${parentObj.type})`,
              );
            }
          }
          const loadParent =
            input.parent !== null && !(input.change.kind === "replace" && input.prefix === "");
          if (loadParent) {
            const rt = await runGit(git, gitdir, ["read-tree", input.parent!], {
              env: indexEnv,
              allowNonZero: true,
            });
            if (rt.status !== 0) {
              throw gitError(
                "REPO_CORRUPT",
                `cannot read parent tree ${input.parent}: ${rt.stderr}`,
              );
            }
          }

          const indexLines: string[] = [];
          const listIndexedUnder = async (targetPrefix: string): Promise<string[]> => {
            const ls = await runGit(git, gitdir, ["ls-files", "-z"], { env: indexEnv });
            const out: string[] = [];
            const slash = `${targetPrefix}/`;
            let pos = 0;
            while (pos < ls.stdout.length) {
              const nul = ls.stdout.indexOf(0, pos);
              if (nul === -1) break;
              const raw = ls.stdout.subarray(pos, nul);
              pos = nul + 1;
              if (raw.length === 0) continue;
              const name = decodeStrictUtf8(raw, "ls-files");
              if (name === targetPrefix || name.startsWith(slash)) {
                out.push(name);
              }
            }
            return out;
          };

          if (input.change.kind === "replace") {
            if (loadParent && input.prefix !== "") {
              for (const p of await listIndexedUnder(input.prefix)) {
                indexLines.push(`0 ${ZERO_OID}\t${p}\0`);
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
              const full = joinPrefix(input.prefix, rel);
              // Match gix editor semantics: remove exact entry OR entire subtree under `full`.
              const matching = loadParent ? await listIndexedUnder(full) : [];
              if (matching.length > 0) {
                for (const p of matching) indexLines.push(`0 ${ZERO_OID}\t${p}\0`);
              } else {
                indexLines.push(`0 ${ZERO_OID}\t${full}\0`);
              }
            }
            const hashed = await hashCommitFiles(input.change.upsert);
            for (const f of hashed) {
              indexLines.push(`${f.mode} ${f.oid}\t${joinPrefix(input.prefix, f.rel)}\0`);
            }
          }

          if (indexLines.length > 0) {
            await runGit(git, gitdir, ["update-index", "--replace", "-z", "--index-info"], {
              input: Buffer.from(indexLines.join(""), "utf8"),
              env: indexEnv,
            });
          }

          const wt = await runGit(git, gitdir, ["write-tree"], { env: indexEnv });
          treeOid = wt.stdout.toString("ascii").trim();

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
          commitOid = ct.stdout.toString("ascii").trim();
        } finally {
          await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
        }

        if (input.beforeMoveRef !== undefined) {
          hookDepth += 1;
          try {
            await input.beforeMoveRef({ commit: commitOid, tree: treeOid });
          } finally {
            hookDepth -= 1;
          }
        }

        const expectedOld = input.parent ?? ZERO_OID;
        const upd = await runGit(
          git,
          gitdir,
          ["update-ref", "--no-deref", input.ref, commitOid, expectedOld],
          {
            allowNonZero: true,
          },
        );
        if (upd.status !== 0) {
          const msg = upd.stderr || `exit ${upd.status}`;
          if (
            msg.includes("is at ") ||
            msg.includes("ref already exists") ||
            msg.includes("Unable to create") ||
            msg.includes("cannot lock ref")
          ) {
            if (msg.includes("Permission denied") || msg.includes("Read-only file system")) {
              throw gitError("IO_ERROR", `ref update I/O failure for ${input.ref}: ${msg}`);
            }
            throw gitError("CAS_CONFLICT", `ref update refused for ${input.ref}: ${msg}`);
          }
          if (msg.includes("not a valid") || msg.includes("invalid ref")) {
            throw gitError("INVALID_REF", `invalid ref ${input.ref}: ${msg}`);
          }
          throw gitError("IO_ERROR", `ref update failed for ${input.ref}: ${msg}`);
        }
        return commitOid;
      });
    },

    close(): Promise<void> {
      if (closePromise !== null) return closePromise;
      closing = true;
      closePromise = (async () => {
        if (inFlight > 0 && hookDepth === 0) {
          await new Promise<void>((resolve) => {
            if (inFlight === 0) resolve();
            else drainWaiters.push(resolve);
          });
        }
        closed = true;
        await batch.close();
      })();
      return closePromise;
    },
  };
}

export function dugiteGitEngine(git: GitProgram, version: string): GitEngine {
  return {
    name: `git ${version} (dugite)`,
    open(gitdir: string): Promise<GitRepo> {
      return openPlumbingRepo(git, gitdir);
    },
  };
}
