/**
 * Hardened pure-plumbing `GitEngine` / `GitRepo` over Git CLI.
 *
 * Guarantees:
 * - Zero hand-written Git file/tree/commit/packed-refs parsers: uses canonical Git plumbing
 *   (`symbolic-ref`, `rev-parse`, `show-ref`, `ls-tree -z`, `rev-list`, `cat-file --batch`,
 *   `cat-file --batch-check`, `hash-object --no-filters`, `update-index`, `write-tree`, `update-ref`).
 * - True streaming direct-to-FS extraction (`BatchCatFile.streamBlobToFile`) with atomic
 *   `.penguin-extract.lock` destination reservation and non-recursive `mkdir` case-collision checks.
 * - Safe FD-based disk hashing (`O_NOFOLLOW | O_NONBLOCK` on Unix + before/after fstat/lstat checks)
 *   so swapped FIFOs or symlinks never hang Git or silently change source bytes.
 * - `AsyncLocalStorage` hook scope prevents `close()` deadlock from `beforeMoveRef` while draining
 *   all admitted operations and retired batch child processes before resolving `close()`.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
  GitIdentity,
  GitRepo,
  GitTreeEntry,
  GitWalkHistoryOptions,
} from "@prismshadow/penguin-core/plugin";
import { type GitProgram } from "./binary.js";
import { runGit, startGit } from "./plumbing-git.js";

const ZERO_OID = "0".repeat(40);
const OID_RE = /^[0-9a-f]{40}$/;
const MAX_BATCH_HEADER_BYTES = 1024;
const EXTRACT_LOCK_NAME = ".penguin-extract.lock";
const RESERVED_WIN_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

// `ignoreBOM: true` preserves leading U+FEFF bytes verbatim in Git filenames (Major #14).
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function gitError(code: GitErrorCode, message: string, cause?: unknown): GitError {
  return Object.assign(new Error(message, cause !== undefined ? { cause } : undefined), { code });
}

function decodeStrictUtf8(buf: Uint8Array, context: string): string {
  try {
    return UTF8_DECODER.decode(buf);
  } catch (err) {
    throw gitError("INVALID_PATH", `non-UTF-8 bytes in ${context}`, err);
  }
}

function stripSingleTrailingNewline(s: string): string {
  if (s.endsWith("\r\n")) return s.slice(0, -2);
  if (s.endsWith("\n")) return s.slice(0, -1);
  return s;
}

function isSafeRelPath(rel: string): boolean {
  if (rel.length === 0 || rel.startsWith("/") || rel.endsWith("/")) return false;
  for (let i = 0; i < rel.length; i += 1) {
    const ch = rel.charCodeAt(i);
    if (ch === 0 || ch === 0x5c || ch === 0x3a) return false;
  }
  for (const seg of rel.split("/")) {
    if (seg.length === 0 || seg === "." || seg === "..") return false;
    if (seg.endsWith(" ") || seg.endsWith(".")) return false;
    // Reject `.git` (case-insensitive) so `update-index` never silently ignores entries (Major #18).
    if (seg.toLowerCase() === ".git") return false;
    const stem = (seg.split(".")[0] ?? seg).toUpperCase();
    if (RESERVED_WIN_NAMES.has(stem)) return false;
  }
  return true;
}

function validateIdentity(who: GitIdentity, role: string): void {
  for (const [field, val] of [
    ["name", who.name],
    ["email", who.email],
  ] as const) {
    if (val.length === 0 || /[\0\r\n<>]/.test(val)) {
      throw gitError(
        "INVALID_PATH",
        `invalid ${role} ${field}: must be non-empty and free of NUL/CR/LF/< / >`,
      );
    }
  }
}

function joinPrefix(prefix: string, rel: string): string {
  return prefix === "" ? rel : `${prefix}/${rel}`;
}

function zoneOf(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(Math.trunc(offsetMinutes));
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}${mm}`;
}

function classifyUpdateRefError(refName: string, stderr: string, status: number): GitError {
  const detail = stderr || `exit ${status}`;
  if (/not a valid refname|invalid ref|fatal: .*refname|bad ref/i.test(detail)) {
    return gitError("INVALID_REF", `invalid ref ${refName}: ${detail}`);
  }
  // Explicit CAS / lock contention patterns ONLY; storage failures (ENOSPC, EROFS, EACCES, EIO) map to IO_ERROR (Major #22).
  if (
    /is at [0-9a-f]+ but expected|but expected|reference already exists|already exists|Unable to create '.*\.lock': File exists|cannot create '.*': .*exists|cannot lock ref '.*': is at|cannot lock ref '.*': reference already exists|cannot lock ref '.*': '.*' exists/i.test(
      detail,
    )
  ) {
    return gitError("CAS_CONFLICT", `ref update refused for ${refName}: ${detail}`);
  }
  return gitError("IO_ERROR", `ref storage error for ${refName}: ${detail}`);
}

/** Gracefully shut down a child process and ALWAYS wait until `close` fires (drains zombies). */
function terminateAndDrainChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(killTimer);
      resolve();
    };
    child.once("close", finish);
    child.once("exit", () => {
      // Wait briefly for close, fallback resolve if already dead
      setTimeout(finish, 200);
    });
    try {
      child.stdin.end();
    } catch {
      // ignore
    }
    const killTimer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, 1500);
    killTimer.unref();
  });
}

interface BatchInfoResult {
  oid: string;
  type: string;
  size: number;
}

/**
 * Persistent `git cat-file --batch-check` helper for zero-subprocess metadata/tree-OID lookups
 * (eliminates N+1 subprocesses in `walkHistory` and `resolveSubtreeOid`, Minor #1).
 */
class BatchCheck {
  private readonly git: GitProgram;
  private readonly gitdir: string;
  private child: ChildProcessWithoutNullStreams | null = null;
  private generation = 0;
  private closed = false;
  private buf: Buffer = Buffer.alloc(0);
  private readonly retired = new Set<Promise<void>>();
  private pending: {
    resolve: (v: BatchInfoResult | null) => void;
    reject: (err: Error) => void;
  } | null = null;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(git: GitProgram, gitdir: string) {
    this.git = git;
    this.gitdir = gitdir;
  }

  private retire(gen: number, err?: Error): void {
    if (gen !== this.generation) return;
    this.generation += 1;
    const proc = this.child;
    this.child = null;
    this.buf = Buffer.alloc(0);
    const p = this.pending;
    this.pending = null;
    if (p) p.reject(err ?? gitError("IO_ERROR", "cat-file --batch-check terminated"));
    if (proc) {
      const drain = terminateAndDrainChild(proc);
      this.retired.add(drain);
      void drain.finally(() => this.retired.delete(drain));
    }
  }

  private ensureChild(): { child: ChildProcessWithoutNullStreams; gen: number } {
    if (this.closed) throw gitError("IO_ERROR", "GitRepo has been closed");
    if (this.child !== null) return { child: this.child, gen: this.generation };
    const gen = ++this.generation;
    const child = startGit(this.git, this.gitdir, ["cat-file", "--batch-check"]);
    this.child = child;
    this.buf = Buffer.alloc(0);

    const onFail = (err: Error) =>
      this.retire(gen, gitError("IO_ERROR", `cat-file --batch-check failed: ${err.message}`, err));
    child.on("error", onFail);
    child.stdin.on("error", onFail);
    child.stdout.on("error", onFail);
    child.stderr.on("error", onFail);
    child.stderr.resume();
    child.on("close", (code, signal) => {
      if (gen !== this.generation) return;
      this.retire(
        gen,
        gitError(
          "IO_ERROR",
          `cat-file --batch-check exited unexpectedly (${signal ?? `code ${code}`})`,
        ),
      );
    });
    child.stdout.on("data", (chunk: Buffer) => {
      if (gen !== this.generation) return;
      this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
      this.drain(gen);
    });
    return { child, gen };
  }

  private drain(gen: number): void {
    const p = this.pending;
    if (p === null) return;
    const nl = this.buf.indexOf(0x0a);
    if (nl === -1) {
      if (this.buf.length > MAX_BATCH_HEADER_BYTES) {
        this.retire(gen, gitError("REPO_CORRUPT", "cat-file --batch-check header exceeded limit"));
      }
      return;
    }
    const line = this.buf.subarray(0, nl).toString("utf8");
    this.buf = this.buf.subarray(nl + 1);
    this.pending = null;
    if (line.endsWith(" missing") || line.endsWith(" ambiguous")) {
      p.resolve(null);
      return;
    }
    const parts = line.split(" ");
    if (parts.length !== 3 || !OID_RE.test(parts[0]!)) {
      this.retire(gen, gitError("REPO_CORRUPT", `unexpected batch-check header: ${line}`));
      return;
    }
    const size = Number(parts[2]);
    if (!Number.isSafeInteger(size) || size < 0) {
      this.retire(gen, gitError("REPO_CORRUPT", `invalid batch-check size: ${line}`));
      return;
    }
    p.resolve({ oid: parts[0]!, type: parts[1]!, size });
  }

  query(spec: string): Promise<BatchInfoResult | null> {
    if (spec.includes("\n") || spec.includes("\r") || spec.includes("\0")) {
      return Promise.reject(gitError("INVALID_PATH", `invalid object spec: ${spec}`));
    }
    const next = this.tail.then(
      () => this.querySerialized(spec),
      () => this.querySerialized(spec),
    );
    this.tail = next.catch(() => undefined);
    return next;
  }

  private querySerialized(spec: string): Promise<BatchInfoResult | null> {
    return new Promise((resolve, reject) => {
      let handle: { child: ChildProcessWithoutNullStreams; gen: number };
      try {
        handle = this.ensureChild();
      } catch (err) {
        reject(err);
        return;
      }
      this.pending = { resolve, reject };
      handle.child.stdin.write(`${spec}\n`);
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    this.retire(this.generation, gitError("IO_ERROR", "GitRepo has been closed"));
    if (this.retired.size > 0) {
      await Promise.allSettled([...this.retired]);
    }
  }
}

/**
 * Streaming `git cat-file --batch` helper.
 * Streams blob bytes directly to disk chunks (`streamBlobToFile`) with stdout pause/resume
 * backpressure so peak JS memory is O(chunk) regardless of blob size (Major #10).
 */
class BatchCatFile {
  private readonly git: GitProgram;
  private readonly gitdir: string;
  private child: ChildProcessWithoutNullStreams | null = null;
  private generation = 0;
  private closed = false;
  private buf: Buffer = Buffer.alloc(0);
  private readonly retired = new Set<Promise<void>>();
  private active: {
    state: "header" | "body" | "lf";
    remaining: number;
    totalSize: number;
    targetPath: string;
    mode: number;
    fh: fs.FileHandle | null;
    writing: boolean;
    resolve: (bytes: number) => void;
    reject: (err: Error) => void;
  } | null = null;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(git: GitProgram, gitdir: string) {
    this.git = git;
    this.gitdir = gitdir;
  }

  private retire(gen: number, err?: Error): void {
    if (gen !== this.generation) return;
    this.generation += 1;
    const proc = this.child;
    this.child = null;
    this.buf = Buffer.alloc(0);
    const act = this.active;
    this.active = null;
    if (act) {
      const fh = act.fh;
      act.fh = null;
      const doneErr = err ?? gitError("IO_ERROR", "cat-file --batch terminated");
      if (fh) {
        void fh.close().finally(() => act.reject(doneErr));
      } else {
        act.reject(doneErr);
      }
    }
    if (proc) {
      const drain = terminateAndDrainChild(proc);
      this.retired.add(drain);
      void drain.finally(() => this.retired.delete(drain));
    }
  }

  private ensureChild(): { child: ChildProcessWithoutNullStreams; gen: number } {
    if (this.closed) throw gitError("IO_ERROR", "GitRepo has been closed");
    if (this.child !== null) return { child: this.child, gen: this.generation };
    const gen = ++this.generation;
    const child = startGit(this.git, this.gitdir, ["cat-file", "--batch"]);
    this.child = child;
    this.buf = Buffer.alloc(0);

    const onFail = (err: Error) =>
      this.retire(gen, gitError("IO_ERROR", `cat-file --batch failed: ${err.message}`, err));
    child.on("error", onFail);
    child.stdin.on("error", onFail);
    child.stdout.on("error", onFail);
    child.stderr.on("error", onFail);
    child.stderr.resume();
    child.on("close", (code, signal) => {
      if (gen !== this.generation) return;
      this.retire(
        gen,
        gitError("IO_ERROR", `cat-file --batch exited unexpectedly (${signal ?? `code ${code}`})`),
      );
    });
    child.stdout.on("data", (chunk: Buffer) => {
      if (gen !== this.generation) return;
      try {
        this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
        this.pump(gen);
      } catch (err) {
        this.retire(
          gen,
          gitError("IO_ERROR", `cat-file --batch stream error: ${(err as Error).message}`, err),
        );
      }
    });
    return { child, gen };
  }

  private pump(gen: number): void {
    const act = this.active;
    if (act === null || act.writing || gen !== this.generation) return;
    const proc = this.child;
    if (proc === null) return;

    if (act.state === "header") {
      const nl = this.buf.indexOf(0x0a);
      if (nl === -1) {
        if (this.buf.length > MAX_BATCH_HEADER_BYTES) {
          this.retire(gen, gitError("REPO_CORRUPT", "cat-file header exceeded max size"));
        }
        return;
      }
      const line = this.buf.subarray(0, nl).toString("utf8");
      this.buf = this.buf.subarray(nl + 1);
      if (line.endsWith(" missing")) {
        this.active = null;
        act.reject(gitError("REPO_CORRUPT", `missing blob object: ${line}`));
        return;
      }
      const parts = line.split(" ");
      if (parts.length !== 3 || !OID_RE.test(parts[0]!)) {
        this.retire(gen, gitError("REPO_CORRUPT", `unexpected cat-file header: ${line}`));
        return;
      }
      if (parts[1] !== "blob") {
        // Retire child so unread non-blob payload never desynchronizes future reads.
        this.retire(gen, gitError("REPO_CORRUPT", `expected blob object, got ${parts[1]}`));
        return;
      }
      const size = Number(parts[2]);
      if (!Number.isSafeInteger(size) || size < 0) {
        this.retire(gen, gitError("REPO_CORRUPT", `invalid cat-file size: ${line}`));
        return;
      }
      act.totalSize = size;
      act.remaining = size;
      act.state = "body";
      act.writing = true;
      proc.stdout.pause();
      void fs.open(act.targetPath, "wx", act.mode).then(
        (fh) => {
          if (gen !== this.generation || this.active !== act) {
            void fh.close().catch(() => undefined);
            return;
          }
          act.fh = fh;
          act.writing = false;
          proc.stdout.resume();
          this.pump(gen);
        },
        (err: NodeJS.ErrnoException) => {
          const mapped =
            err.code === "EEXIST"
              ? gitError("INVALID_PATH", `file case or path collision at ${act.targetPath}`, err)
              : gitError("IO_ERROR", `cannot create ${act.targetPath}: ${err.message}`, err);
          this.retire(gen, mapped);
        },
      );
      return;
    }

    if (act.state === "body") {
      if (act.remaining === 0) {
        act.state = "lf";
      } else if (this.buf.length > 0) {
        const take = Math.min(act.remaining, this.buf.length);
        const slice = this.buf.subarray(0, take);
        this.buf = this.buf.subarray(take);
        act.remaining -= take;
        act.writing = true;
        proc.stdout.pause();
        const fh = act.fh!;
        void (async () => {
          let offset = 0;
          while (offset < slice.length) {
            const { bytesWritten } = await fh.write(slice, offset, slice.length - offset);
            if (bytesWritten <= 0) throw new Error("short write while extracting blob");
            offset += bytesWritten;
          }
        })().then(
          () => {
            if (gen !== this.generation || this.active !== act) return;
            act.writing = false;
            if (act.remaining === 0) act.state = "lf";
            proc.stdout.resume();
            this.pump(gen);
          },
          (err: Error) => {
            this.retire(
              gen,
              gitError("IO_ERROR", `cannot write ${act.targetPath}: ${err.message}`, err),
            );
          },
        );
        return;
      } else {
        return;
      }
    }

    if (act.state === "lf") {
      if (this.buf.length < 1) return;
      if (this.buf[0] !== 0x0a) {
        this.retire(gen, gitError("REPO_CORRUPT", "missing trailing LF after cat-file body"));
        return;
      }
      this.buf = this.buf.subarray(1);
      const fh = act.fh;
      act.fh = null;
      const total = act.totalSize;
      this.active = null;
      if (fh) {
        proc.stdout.pause();
        void fh.close().then(
          () => {
            if (gen === this.generation && this.child === proc) proc.stdout.resume();
            act.resolve(total);
          },
          (err: Error) => {
            this.retire(
              gen,
              gitError("IO_ERROR", `cannot close ${act.targetPath}: ${err.message}`, err),
            );
          },
        );
      } else {
        act.resolve(total);
      }
    }
  }

  streamBlobToFile(oid: string, targetPath: string, mode: number): Promise<number> {
    if (!OID_RE.test(oid)) return Promise.reject(gitError("INVALID_OID", `invalid oid: ${oid}`));
    const next = this.tail.then(
      () => this.streamSerialized(oid, targetPath, mode),
      () => this.streamSerialized(oid, targetPath, mode),
    );
    this.tail = next.catch(() => undefined);
    return next;
  }

  private streamSerialized(oid: string, targetPath: string, mode: number): Promise<number> {
    return new Promise((resolve, reject) => {
      let handle: { child: ChildProcessWithoutNullStreams; gen: number };
      try {
        handle = this.ensureChild();
      } catch (err) {
        reject(err);
        return;
      }
      this.active = {
        state: "header",
        remaining: 0,
        totalSize: 0,
        targetPath,
        mode,
        fh: null,
        writing: false,
        resolve,
        reject,
      };
      handle.child.stdin.write(`${oid}\n`);
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    this.retire(this.generation, gitError("IO_ERROR", "GitRepo has been closed"));
    if (this.retired.size > 0) {
      await Promise.allSettled([...this.retired]);
    }
  }
}

/**
 * Safely stream a regular disk file directly into `git hash-object -w --no-filters --stdin`
 * using an already-opened file descriptor (`O_NOFOLLOW | O_NONBLOCK` on Unix) so swapped FIFOs
 * or symlinks never block Git or silently substitute bytes (Major #11).
 */
async function hashDiskFileSafely(
  git: GitProgram,
  gitdir: string,
  filePath: string,
): Promise<string> {
  let preLstat;
  try {
    preLstat = await fs.lstat(filePath);
  } catch (err) {
    throw gitError("IO_ERROR", `cannot stat ${filePath}: ${(err as Error).message}`, err);
  }
  if (!preLstat.isFile()) {
    throw gitError("INVALID_PATH", `source path is not a regular file: ${filePath}`);
  }

  const openFlags =
    process.platform === "win32"
      ? fsSync.constants.O_RDONLY
      : fsSync.constants.O_RDONLY |
        (fsSync.constants.O_NOFOLLOW ?? 0) |
        (fsSync.constants.O_NONBLOCK ?? 0);

  let fh: fs.FileHandle;
  try {
    fh = await fs.open(filePath, openFlags);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ELOOP" || code === "ENXIO") {
      throw gitError("INVALID_PATH", `source path is a symlink or special file: ${filePath}`, err);
    }
    throw gitError("IO_ERROR", `cannot open ${filePath}: ${(err as Error).message}`, err);
  }

  try {
    const fdBefore = await fh.stat();
    if (!fdBefore.isFile()) {
      throw gitError("INVALID_PATH", `source path is not a regular file: ${filePath}`);
    }
    if (
      fdBefore.dev !== preLstat.dev ||
      fdBefore.ino !== preLstat.ino ||
      fdBefore.size !== preLstat.size ||
      fdBefore.mtimeMs !== preLstat.mtimeMs
    ) {
      throw gitError("SOURCE_CHANGED", `source changed during open: ${filePath}`);
    }

    const oid = await new Promise<string>((resolve, reject) => {
      const child = startGit(git, gitdir, ["hash-object", "-w", "--no-filters", "--stdin"]);
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
        reject(err);
      };
      child.stdout.on("data", (c: Buffer) => stdout.push(c));
      child.stderr.on("data", (c: Buffer) => stderr.push(c));
      child.stdout.on("error", fail);
      child.stderr.on("error", fail);
      child.stdin.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code !== "EPIPE") fail(err);
      });
      child.on("error", fail);
      child.on("close", (code, signal) => {
        if (settled) return;
        settled = true;
        if (signal !== null || code !== 0) {
          const msg = Buffer.concat(stderr).toString("utf8").trim();
          reject(
            gitError(
              "IO_ERROR",
              `hash-object failed for ${filePath}: ${msg || signal || `exit ${code}`}`,
            ),
          );
          return;
        }
        const out = Buffer.concat(stdout).toString("ascii").trim();
        if (!OID_RE.test(out)) {
          reject(gitError("IO_ERROR", `hash-object returned invalid oid: ${out}`));
          return;
        }
        resolve(out);
      });

      const chunkBuf = Buffer.allocUnsafe(64 * 1024);
      let totalRead = 0;
      void (async () => {
        try {
          while (true) {
            const { bytesRead } = await fh.read(chunkBuf, 0, chunkBuf.length, null);
            if (bytesRead === 0) break;
            totalRead += bytesRead;
            if (totalRead > fdBefore.size) {
              throw gitError("SOURCE_CHANGED", `source grew during read: ${filePath}`);
            }
            const part = chunkBuf.subarray(0, bytesRead);
            if (!child.stdin.write(part)) {
              await new Promise<void>((res, rej) => {
                const onDrain = () => {
                  cleanup();
                  res();
                };
                const onErr = (e: Error) => {
                  cleanup();
                  rej(e);
                };
                const cleanup = () => {
                  child.stdin.off("drain", onDrain);
                  child.stdin.off("error", onErr);
                };
                child.stdin.once("drain", onDrain);
                child.stdin.once("error", onErr);
              });
            }
          }
          if (totalRead !== fdBefore.size) {
            throw gitError("SOURCE_CHANGED", `source shrank during read: ${filePath}`);
          }
          child.stdin.end();
        } catch (err) {
          fail(err instanceof Error ? err : new Error(String(err)));
        }
      })();
    });

    const fdAfter = await fh.stat();
    if (
      !fdAfter.isFile() ||
      fdAfter.size !== fdBefore.size ||
      fdAfter.mtimeMs !== fdBefore.mtimeMs
    ) {
      throw gitError("SOURCE_CHANGED", `source file modified during hash: ${filePath}`);
    }
    let postLstat;
    try {
      postLstat = await fs.lstat(filePath);
    } catch (err) {
      throw gitError("SOURCE_CHANGED", `source disappeared during hash: ${filePath}`, err);
    }
    if (
      !postLstat.isFile() ||
      postLstat.dev !== fdBefore.dev ||
      postLstat.ino !== fdBefore.ino ||
      postLstat.size !== fdBefore.size ||
      postLstat.mtimeMs !== fdBefore.mtimeMs
    ) {
      throw gitError("SOURCE_CHANGED", `source path replaced during hash: ${filePath}`);
    }
    return oid;
  } finally {
    await fh.close().catch(() => undefined);
  }
}

function parseLsTreeZ(buf: Buffer, withSize: boolean, stripPrefix: string): GitTreeEntry[] {
  const entries: GitTreeEntry[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const nul = buf.indexOf(0, pos);
    if (nul === -1) break;
    const record = buf.subarray(pos, nul);
    pos = nul + 1;
    if (record.length === 0) continue;
    const tab = record.indexOf(0x09);
    if (tab === -1) {
      throw gitError("REPO_CORRUPT", "malformed git ls-tree -z record (missing TAB)");
    }
    const header = record.subarray(0, tab).toString("ascii");
    const rawRel = decodeStrictUtf8(record.subarray(tab + 1), "ls-tree path");
    const parts = header.trim().split(/\s+/);
    const mode = parts[0];
    const type = parts[1];
    const oid = parts[2];
    if (type !== "blob" || (mode !== "100644" && mode !== "100755")) continue;
    if (!oid || !OID_RE.test(oid)) {
      throw gitError("REPO_CORRUPT", `invalid oid in ls-tree output: ${header}`);
    }
    const rel =
      stripPrefix !== "" && rawRel.startsWith(`${stripPrefix}/`)
        ? rawRel.slice(stripPrefix.length + 1)
        : rawRel;
    const entry: GitTreeEntry = { rel, oid, mode: mode as GitFileMode };
    if (withSize) {
      const sizeNum = Number(parts[3]);
      if (!Number.isSafeInteger(sizeNum) || sizeNum < 0) {
        throw gitError("REPO_CORRUPT", `invalid blob size in ls-tree -l: ${header}`);
      }
      entry.size = sizeNum;
    }
    entries.push(entry);
  }
  return entries;
}

function openPlumbingRepo(git: GitProgram, gitdir: string): GitRepo {
  const hookScope = new AsyncLocalStorage<symbol>();
  const batchCheck = new BatchCheck(git, gitdir);
  const batchCat = new BatchCatFile(git, gitdir);
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

  /**
   * Resolve subtree OID at `prefix` under `commitOid`, distinguishing legitimate absence (`null`)
   * from repository corruption (`REPO_CORRUPT`) (Major #17).
   */
  async function resolveSubtreeOid(commitOid: string, prefix: string): Promise<string | null> {
    const commitInfo = await batchCheck.query(commitOid);
    if (commitInfo === null) return null;
    if (commitInfo.type !== "commit") {
      throw gitError("INVALID_OID", `${commitOid} is not a commit (${commitInfo.type})`);
    }
    const rootTree = await batchCheck.query(`${commitOid}^{tree}`);
    if (rootTree === null || rootTree.type !== "tree") {
      throw gitError("REPO_CORRUPT", `commit ${commitOid} references missing or non-tree root`);
    }
    if (prefix === "") return rootTree.oid;

    let curTree = rootTree.oid;
    for (const seg of prefix.split("/")) {
      const ls = await runGit(git, gitdir, ["ls-tree", "-z", curTree, "--", seg], {
        allowNonZero: true,
      });
      if (ls.status !== 0) {
        throw gitError("REPO_CORRUPT", `git ls-tree failed on ${curTree}: ${ls.stderr}`);
      }
      if (ls.stdout.length === 0) return null;
      const nul = ls.stdout.indexOf(0);
      const record = nul === -1 ? ls.stdout : ls.stdout.subarray(0, nul);
      const tab = record.indexOf(0x09);
      if (tab === -1) {
        throw gitError("REPO_CORRUPT", `malformed ls-tree entry in ${curTree}`);
      }
      const header = record.subarray(0, tab).toString("ascii").trim().split(/\s+/);
      const name = decodeStrictUtf8(record.subarray(tab + 1), "ls-tree segment");
      if (name !== seg) return null;
      const type = header[1];
      const oid = header[2];
      if (type !== "tree") return null;
      if (!oid || !OID_RE.test(oid)) {
        throw gitError("REPO_CORRUPT", `invalid subtree oid in ${curTree}`);
      }
      const subInfo = await batchCheck.query(oid);
      if (subInfo === null || subInfo.type !== "tree") {
        throw gitError("REPO_CORRUPT", `subtree ${oid} at ${prefix} is missing or corrupt`);
      }
      curTree = oid;
    }
    return curTree;
  }

  async function listTreeInternal(
    commitOid: string,
    prefix: string,
    opts?: { withSize?: boolean },
  ): Promise<GitTreeEntry[] | null> {
    if (!OID_RE.test(commitOid)) {
      throw gitError("INVALID_OID", `invalid commitOid: ${commitOid}`);
    }
    if (prefix !== "" && !isSafeRelPath(prefix)) {
      throw gitError("INVALID_PATH", `unsafe prefix: ${prefix}`);
    }
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
    const results: Array<{ rel: string; oid: string; mode: GitFileMode }> = [];
    for (const f of files) {
      const mode: GitFileMode = f.mode ?? "100644";
      if (f.source.kind === "file") {
        const oid = await hashDiskFileSafely(git, gitdir, f.source.path);
        results.push({ rel: f.rel, oid, mode });
      } else {
        const res = await runGit(git, gitdir, ["hash-object", "-w", "--no-filters", "--stdin"], {
          input: f.source.body,
        });
        results.push({ rel: f.rel, oid: res.stdout.toString("ascii").trim(), mode });
      }
    }
    return results;
  }

  return {
    resolveHead(): Promise<{ ref: string; commit: string | null }> {
      return runAdmitted(async () => {
        const sym = await runGit(git, gitdir, ["symbolic-ref", "HEAD"], { allowNonZero: true });
        if (sym.status !== 0) {
          throw gitError(
            "INVALID_REF",
            `HEAD is detached, unreadable, or corrupt in ${gitdir}: ${sym.stderr}`,
          );
        }
        // Strip ONLY the trailing protocol newline, preserving any valid trailing Unicode spaces (Major #14).
        const ref = stripSingleTrailingNewline(decodeStrictUtf8(sym.stdout, "symbolic-ref HEAD"));
        if (!ref.startsWith("refs/")) {
          throw gitError("INVALID_REF", `HEAD points to non-ref target: ${ref}`);
        }

        const resolveCommit = async (): Promise<string | null> => {
          const rev = await runGit(
            git,
            gitdir,
            ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
            {
              allowNonZero: true,
            },
          );
          if (rev.status === 0) {
            const oid = stripSingleTrailingNewline(rev.stdout.toString("ascii"));
            if (!OID_RE.test(oid)) {
              throw gitError("INVALID_REF", `ref ${ref} resolved to invalid oid ${oid}`);
            }
            return oid;
          }
          return null;
        };

        const first = await resolveCommit();
        if (first !== null) return { ref, commit: first };

        // Distinguish unborn branch vs broken loose/packed ref vs first-commit race (Major #15).
        const existsRes = await runGit(git, gitdir, ["show-ref", "--exists", ref], {
          allowNonZero: true,
        });
        if (existsRes.status === 2) {
          // Git 2.43+ exit code 2 means the ref genuinely does not exist in loose OR packed-refs.
          // Double-check for a corrupt empty/unreadable loose file at the exact path.
          const loosePath = path.join(gitdir, ...ref.split("/"));
          try {
            await fs.lstat(loosePath);
            throw gitError("INVALID_REF", `loose ref ${ref} exists but is invalid or empty`);
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") {
              return { ref, commit: null };
            }
            throw err;
          }
        }
        if (existsRes.status === 0) {
          // Ref exists! Retry commit peel once in case a concurrent first commit just published it.
          const retried = await resolveCommit();
          if (retried !== null) return { ref, commit: retried };
          throw gitError("INVALID_REF", `ref ${ref} exists but does not resolve to a valid commit`);
        }
        // Fallback for older Git lacking `show-ref --exists`: retry commit peel, else inspect loose/packed refs.
        const retried = await resolveCommit();
        if (retried !== null) return { ref, commit: retried };
        const loosePath = path.join(gitdir, ...ref.split("/"));
        try {
          await fs.lstat(loosePath);
          throw gitError("INVALID_REF", `ref ${ref} exists but is invalid`);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }
        const packed = await fs.readFile(path.join(gitdir, "packed-refs"), "utf8").catch(() => "");
        for (const line of packed.split(/\r?\n/)) {
          if (line.length === 0 || line.startsWith("#") || line.startsWith("^")) continue;
          const sp = line.indexOf(" ");
          if (sp !== -1 && line.slice(sp + 1) === ref) {
            throw gitError(
              "INVALID_REF",
              `packed ref ${ref} exists but its target commit is invalid`,
            );
          }
        }
        return { ref, commit: null };
      });
    },

    listTree(
      commitOid: string,
      prefix: string,
      opts?: { withSize?: boolean },
    ): Promise<GitTreeEntry[] | null> {
      return runAdmitted(() => listTreeInternal(commitOid, prefix, opts));
    },

    walkHistory(opts: GitWalkHistoryOptions): Promise<GitHistoryEntry[]> {
      return runAdmitted(async () => {
        if (!OID_RE.test(opts.fromCommit)) {
          throw gitError("INVALID_OID", `invalid fromCommit: ${opts.fromCommit}`);
        }
        if (opts.prefix !== "" && !isSafeRelPath(opts.prefix)) {
          throw gitError("INVALID_PATH", `unsafe prefix: ${opts.prefix}`);
        }
        if (opts.limit === 0 || opts.maxWalk === 0) return [];

        const revList = await runGit(
          git,
          gitdir,
          [
            "rev-list",
            "--first-parent",
            `--max-count=${opts.maxWalk + 1}`,
            "--format=format:%H %ct %T",
            opts.fromCommit,
          ],
          { allowNonZero: true },
        );
        if (revList.status !== 0) {
          const exists = await batchCheck.query(opts.fromCommit);
          if (exists === null) return [];
          throw gitError(
            "REPO_CORRUPT",
            `rev-list failed from ${opts.fromCommit}: ${revList.stderr}`,
          );
        }

        const chain: Array<{ commit: string; committerTime: number; rootTree: string }> = [];
        for (const line of revList.stdout.toString("utf8").split(/\r?\n/)) {
          if (!line || line.startsWith("commit ")) continue;
          const parts = line.split(" ");
          if (parts.length !== 3 || !OID_RE.test(parts[0]!) || !OID_RE.test(parts[2]!)) {
            throw gitError("REPO_CORRUPT", `unexpected rev-list line: ${line}`);
          }
          const ts = Number(parts[1]);
          if (!Number.isSafeInteger(ts)) {
            throw gitError("REPO_CORRUPT", `invalid committer timestamp in rev-list: ${line}`);
          }
          chain.push({ commit: parts[0]!, committerTime: ts, rootTree: parts[2]! });
        }
        if (chain.length === 0) return [];

        // Resolve subtree OIDs via persistent batch-check (O(1) subprocesses instead of O(N), Minor #1).
        const subtreeAt = async (row: {
          commit: string;
          rootTree: string;
        }): Promise<string | null> => {
          if (opts.prefix === "") {
            const info = await batchCheck.query(row.rootTree);
            if (info === null || info.type !== "tree") {
              throw gitError("REPO_CORRUPT", `root tree ${row.rootTree} missing for ${row.commit}`);
            }
            return row.rootTree;
          }
          const rootInfo = await batchCheck.query(row.rootTree);
          if (rootInfo === null || rootInfo.type !== "tree") {
            throw gitError("REPO_CORRUPT", `root tree ${row.rootTree} missing for ${row.commit}`);
          }
          if (opts.prefix.includes("\n") || opts.prefix.includes("\r")) {
            return resolveSubtreeOid(row.commit, opts.prefix);
          }
          const sub = await batchCheck.query(`${row.rootTree}:${opts.prefix}`);
          if (sub === null || sub.type !== "tree") return null;
          return sub.oid;
        };

        const out: GitHistoryEntry[] = [];
        const startTree = await subtreeAt(chain[0]!);
        if (startTree === null) return [];

        let currTree: string | null = startTree;
        const walkCount = Math.min(chain.length, opts.maxWalk);
        for (let i = 0; i < walkCount && out.length < opts.limit; i += 1) {
          const curr = chain[i]!;
          if (currTree === null) break;
          const next = i + 1 < chain.length ? chain[i + 1]! : null;
          const nextTree = next !== null ? await subtreeAt(next) : null;
          if (next === null || nextTree !== currTree) {
            out.push({
              commit: curr.commit,
              tree: currTree,
              committerTime: curr.committerTime,
            });
          }
          currTree = nextTree;
        }

        if (out.length === 0 && startTree !== null && walkCount > 0) {
          const oldest = chain[walkCount - 1]!;
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
        } else {
          await fs.mkdir(opts.destDir, { recursive: true });
        }

        // Reserve destination directory atomically via exclusive lockfile (Major #12).
        const lockPath = path.join(opts.destDir, EXTRACT_LOCK_NAME);
        let lockFh: fs.FileHandle;
        try {
          lockFh = await fs.open(lockPath, "wx");
          await lockFh.close();
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "EEXIST") {
            throw gitError("DEST_NOT_EMPTY", `${opts.destDir} is currently locked or not empty`);
          }
          throw gitError("IO_ERROR", `cannot lock ${opts.destDir}: ${(err as Error).message}`, err);
        }

        try {
          const existing = await fs.readdir(opts.destDir);
          if (existing.some((name) => name !== EXTRACT_LOCK_NAME)) {
            throw gitError("DEST_NOT_EMPTY", `${opts.destDir} is not empty`);
          }

          const listed = await listTreeInternal(opts.commitOid, opts.prefix, { withSize: false });
          if (listed === null || listed.length === 0) {
            return { files: [], totalBytes: 0 };
          }
          const selected =
            filterSet === null ? listed : listed.filter((e) => filterSet!.has(e.rel));
          if (selected.length === 0) {
            return { files: [], totalBytes: 0 };
          }

          const files: string[] = [];
          let totalBytes = 0;
          const createdDirs = new Set<string>();

          for (const entry of selected) {
            if (!isSafeRelPath(entry.rel)) {
              throw gitError("INVALID_PATH", `unsafe tree entry path: ${entry.rel}`);
            }
            // Create parent dirs non-recursively so case-insensitive FS directory merges fail loudly (Major #13).
            const parts = entry.rel.split("/");
            let curDir = opts.destDir;
            let curRel = "";
            for (let i = 0; i < parts.length - 1; i += 1) {
              const part = parts[i]!;
              curRel = curRel === "" ? part : `${curRel}/${part}`;
              curDir = path.join(curDir, part);
              if (!createdDirs.has(curRel)) {
                try {
                  await fs.mkdir(curDir);
                } catch (err) {
                  if ((err as NodeJS.ErrnoException).code === "EEXIST") {
                    throw gitError("INVALID_PATH", `directory case or path collision at ${curRel}`);
                  }
                  throw gitError(
                    "IO_ERROR",
                    `cannot create directory ${curRel}: ${(err as Error).message}`,
                    err,
                  );
                }
                createdDirs.add(curRel);
              }
            }
            const target = path.join(curDir, parts[parts.length - 1]!);
            const mode = entry.mode === "100755" ? 0o777 : 0o666;
            // Stream blob bytes straight from cat-file stdout to disk (Major #10).
            const bytes = await batchCat.streamBlobToFile(entry.oid, target, mode);
            totalBytes += bytes;
            files.push(entry.rel);
          }

          return { files, totalBytes };
        } finally {
          await fs.rm(lockPath, { force: true }).catch(() => undefined);
        }
      });
    },

    commit(input: GitCommitInput): Promise<string> {
      return runAdmitted(async () => {
        // Snapshot mutable operands upfront so beforeMoveRef cannot alter CAS target/parent (Major #2).
        const refName = String(input.ref);
        const expectedParent = input.parent === null ? null : String(input.parent);
        const prefix = String(input.prefix);
        const message = String(input.message);
        const author: GitIdentity = {
          name: String(input.author.name),
          email: String(input.author.email),
        };
        const committer: GitIdentity = {
          name: String(input.committer.name),
          email: String(input.committer.email),
        };
        const whenSeconds = input.when.seconds;
        const whenOffset = input.when.offset;
        const change = input.change;
        const beforeMoveRef = input.beforeMoveRef;

        if (expectedParent !== null && !OID_RE.test(expectedParent)) {
          throw gitError("INVALID_OID", `invalid parent oid: ${expectedParent}`);
        }
        if (prefix !== "" && !isSafeRelPath(prefix)) {
          throw gitError("INVALID_PATH", `unsafe prefix: ${prefix}`);
        }
        if (!refName.startsWith("refs/")) {
          throw gitError("INVALID_REF", `invalid ref name: ${refName}`);
        }
        if (!Number.isFinite(whenSeconds) || whenSeconds < 0) {
          throw gitError("INVALID_PATH", `invalid commit timestamp: ${whenSeconds}`);
        }
        validateIdentity(author, "author");
        validateIdentity(committer, "committer");

        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-gitcl-idx-"));
        const tmpIndex = path.join(tmpDir, "index");
        const indexEnv: NodeJS.ProcessEnv = { GIT_INDEX_FILE: tmpIndex };
        let treeOid: string;
        let commitOid: string;

        try {
          if (expectedParent !== null) {
            const parentInfo = await batchCheck.query(expectedParent);
            if (parentInfo === null) {
              throw gitError("PARENT_NOT_FOUND", `parent ${expectedParent} is not in repository`);
            }
            if (parentInfo.type !== "commit") {
              throw gitError(
                "INVALID_OID",
                `parent ${expectedParent} is not a commit (${parentInfo.type})`,
              );
            }
          }
          const loadParent =
            expectedParent !== null && !(change.kind === "replace" && prefix === "");
          if (loadParent) {
            const rt = await runGit(git, gitdir, ["read-tree", expectedParent!], {
              env: indexEnv,
              allowNonZero: true,
            });
            if (rt.status !== 0) {
              throw gitError(
                "REPO_CORRUPT",
                `cannot read parent tree ${expectedParent}: ${rt.stderr}`,
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

          if (change.kind === "replace") {
            if (loadParent && prefix !== "") {
              for (const p of await listIndexedUnder(prefix)) {
                indexLines.push(`0 ${ZERO_OID}\t${p}\0`);
              }
            }
            if (change.files !== null) {
              const hashed = await hashCommitFiles(change.files);
              for (const f of hashed) {
                indexLines.push(`${f.mode} ${f.oid}\t${joinPrefix(prefix, f.rel)}\0`);
              }
            }
          } else {
            for (const rel of change.remove) {
              if (!isSafeRelPath(rel)) throw gitError("INVALID_PATH", `unsafe remove path: ${rel}`);
              const full = joinPrefix(prefix, rel);
              const matching = loadParent ? await listIndexedUnder(full) : [];
              if (matching.length > 0) {
                for (const p of matching) indexLines.push(`0 ${ZERO_OID}\t${p}\0`);
              } else {
                indexLines.push(`0 ${ZERO_OID}\t${full}\0`);
              }
            }
            const hashed = await hashCommitFiles(change.upsert);
            for (const f of hashed) {
              indexLines.push(`${f.mode} ${f.oid}\t${joinPrefix(prefix, f.rel)}\0`);
            }
          }

          if (indexLines.length > 0) {
            const ui = await runGit(
              git,
              gitdir,
              ["update-index", "--replace", "-z", "--index-info"],
              {
                input: Buffer.from(indexLines.join(""), "utf8"),
                env: indexEnv,
              },
            );
            // Never silently publish a commit if Git ignored any requested path (Major #18).
            if (/Ignoring path/i.test(ui.stderr)) {
              throw gitError("INVALID_PATH", `git update-index ignored path: ${ui.stderr}`);
            }
          }

          const wt = await runGit(git, gitdir, ["write-tree"], { env: indexEnv });
          treeOid = wt.stdout.toString("ascii").trim();

          // Write commit object via `hash-object -t commit -w --stdin` so valid identities like
          // `Example Inc.` are preserved verbatim identically to gix and fast-import (Major #20).
          const stamp = `${Math.trunc(whenSeconds)} ${zoneOf(whenOffset)}`;
          const headerLines = [
            `tree ${treeOid}`,
            ...(expectedParent !== null ? [`parent ${expectedParent}`] : []),
            `author ${author.name} <${author.email}> ${stamp}`,
            `committer ${committer.name} <${committer.email}> ${stamp}`,
            "",
          ];
          const commitPayload = Buffer.concat([
            Buffer.from(`${headerLines.join("\n")}\n`, "utf8"),
            Buffer.from(message, "utf8"),
          ]);
          const ct = await runGit(git, gitdir, ["hash-object", "-t", "commit", "-w", "--stdin"], {
            input: commitPayload,
          });
          commitOid = ct.stdout.toString("ascii").trim();
          if (!OID_RE.test(commitOid)) {
            throw gitError("IO_ERROR", `hash-object returned invalid commit oid: ${commitOid}`);
          }
        } finally {
          await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
        }

        if (beforeMoveRef !== undefined) {
          const frozenSnapshot = Object.freeze({ commit: commitOid, tree: treeOid });
          await hookScope.run(Symbol("beforeMoveRef"), () => beforeMoveRef(frozenSnapshot));
        }

        const expectedOld = expectedParent ?? ZERO_OID;
        const upd = await runGit(
          git,
          gitdir,
          ["update-ref", "--no-deref", refName, commitOid, expectedOld],
          {
            allowNonZero: true,
          },
        );
        if (upd.status !== 0) {
          throw classifyUpdateRefError(refName, upd.stderr, upd.status);
        }
        return commitOid;
      });
    },

    close(): Promise<void> {
      if (hookScope.getStore() !== undefined) {
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
        await Promise.allSettled([batchCheck.close(), batchCat.close()]);
      })();
      return closePromise;
    },
  };
}

export function dugiteGitEngine(git: GitProgram, version: string): GitEngine {
  return {
    name: `git ${version} (dugite)`,
    async open(gitdir: string): Promise<GitRepo> {
      try {
        await fs.stat(path.join(gitdir, "HEAD"));
      } catch (err) {
        throw gitError("IO_ERROR", `cannot open bare repository ${gitdir}`, err);
      }
      return openPlumbingRepo(git, gitdir);
    },
  };
}
