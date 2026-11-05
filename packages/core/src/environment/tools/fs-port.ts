/**
 * The file-system port of the file tools. read_file, edit_file and write_file do their
 * file-system work through this interface rather than through `node:fs` directly, so that
 * the same tool code runs against two implementations: the harness process itself
 * (`localFsPort`), and a helper process the Session's sandbox confines exactly as it
 * confines a command (see fs-worker.ts). Which one a call gets is the Environment's
 * decision, made from the Session's confiner at every call: an unconfined Session works
 * in-process, a confined one through the helper.
 *
 * The surface is the handful of primitives the three tools need, spelled so both sides
 * can carry them over a JSON line: plain stat facts instead of a `Stats` object, bytes
 * instead of file handles, a fetch that answers with the body already read. Errors keep
 * their `code` (ENOENT, EISDIR, EROFS…) on both sides, since the tools diagnose from it.
 */
import path from "node:path";
import { mkdir, open, readdir, readFile, readlink, realpath, stat } from "node:fs/promises";
import { atomicWriteFile } from "../../internal/atomic-write.js";

export interface FsStat {
  isFile: boolean;
  isDirectory: boolean;
  size: number;
  /** The permission bits, for an overwrite that keeps them. */
  mode: number;
}

export interface FsDirent {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
}

/** What a URL read comes back with: the response's status and type, and its whole body. */
export interface FsFetchResult {
  ok: boolean;
  status: number;
  contentType: string | null;
  bytes: Buffer;
}

export interface FsPort {
  stat(target: string): Promise<FsStat>;
  /** The whole file; the caller has checked the size. */
  readFile(target: string): Promise<Buffer>;
  /** Up to `length` bytes from `position`; fewer at the end of the file, none past it. */
  readRange(target: string, position: number, length: number): Promise<Buffer>;
  readdir(target: string): Promise<FsDirent[]>;
  realpath(target: string): Promise<string>;
  readlink(target: string): Promise<string>;
  /** Creates the directory and its missing parents. */
  mkdir(target: string): Promise<void>;
  /** Writes atomically (temp file + rename); `followSymlinks` lands the content where a link points (see atomic-write.ts). */
  writeFileAtomic(
    target: string,
    content: Buffer,
    opts: { mode?: number; followSymlinks?: boolean },
  ): Promise<void>;
  /** Downloads `url` whole; `maxBytes` caps the body, a declared or actual size beyond it rejects with code `ETOOBIG`. */
  fetch(url: string, opts: { maxBytes: number; signal?: AbortSignal }): Promise<FsFetchResult>;
}

/** The port a file tool works through: the primitives, and whether they run in the sandboxed helper — which decides how a refused effect is worded. */
export interface ToolFs extends FsPort {
  readonly sandboxed: boolean;
}

/** The port over this process's own file system: what an unconfined Session works through. */
export const localFsPort: ToolFs = {
  sandboxed: false,
  async stat(target) {
    const st = await stat(target);
    return { isFile: st.isFile(), isDirectory: st.isDirectory(), size: st.size, mode: st.mode };
  },
  readFile: (target) => readFile(target),
  async readRange(target, position, length) {
    const fd = await open(target, "r");
    try {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await fd.read(buf, 0, length, position);
      return buf.subarray(0, bytesRead);
    } finally {
      await fd.close();
    }
  },
  async readdir(target) {
    const entries = await readdir(target, { withFileTypes: true });
    return entries.map((e) => ({ name: e.name, isFile: e.isFile(), isDirectory: e.isDirectory() }));
  },
  realpath: (target) => realpath(target),
  readlink: (target) => readlink(target),
  async mkdir(target) {
    await mkdir(target, { recursive: true });
  },
  writeFileAtomic: (target, content, opts) => atomicWriteFile(target, content, opts),
  async fetch(url, opts) {
    const res = await fetch(url, opts.signal ? { signal: opts.signal } : {});
    const declared = Number(res.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > opts.maxBytes) throw tooBig(declared);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > opts.maxBytes) throw tooBig(bytes.length);
    return { ok: res.ok, status: res.status, contentType: res.headers.get("content-type"), bytes };
  },
};

/**
 * A port that decides which port it is on first use: the Environment hands every tool call
 * one of these, and only a tool that touches a file — the first `sandboxed` read or
 * primitive — makes it ask the Session's confiner, so a command or an MCP call never
 * consults the confiner on the file tools' behalf. What `resolve` throws (a policy no
 * backend can enforce) surfaces from that first use, as the tool's failure.
 */
export function lazyToolFs(resolve: () => ToolFs): ToolFs {
  let resolved: ToolFs | null = null;
  const get = (): ToolFs => (resolved ??= resolve());
  return {
    get sandboxed() {
      return get().sandboxed;
    },
    stat: (target) => get().stat(target),
    readFile: (target) => get().readFile(target),
    readRange: (target, position, length) => get().readRange(target, position, length),
    readdir: (target) => get().readdir(target),
    realpath: (target) => get().realpath(target),
    readlink: (target) => get().readlink(target),
    mkdir: (target) => get().mkdir(target),
    writeFileAtomic: (target, content, opts) => get().writeFileAtomic(target, content, opts),
    fetch: (url, opts) => get().fetch(url, opts),
  };
}

/** The error a fetch past `maxBytes` rejects with: `size` is what was declared or read. */
export function tooBig(size: number): Error & { code: string; size: number } {
  return Object.assign(new Error(`response body of ${size} bytes exceeds the limit`), {
    code: "ETOOBIG",
    size,
  });
}

/** The `code` of a file-system error, or undefined. */
export function errorCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

/**
 * An error as a tool reports it. Under a confining sandbox the kernel answers a refused
 * effect with a permission error the model would otherwise read as the file's own — so
 * when the port is the sandboxed one, those codes name the sandbox.
 */
export function describeFsError(err: unknown, sandboxed: boolean): string {
  const message = err instanceof Error ? err.message : String(err);
  const code = errorCode(err);
  if (sandboxed && (code === "EROFS" || code === "EACCES" || code === "EPERM")) {
    return `${message} — refused by this session's sandbox, which does not allow that here.`;
  }
  return message;
}

/** The path the write aimed at `target` lands on: the end of its symlink chain, through the port. */
export async function resolveWriteTargetThrough(fs: FsPort, target: string): Promise<string> {
  let current = target;
  for (let hop = 0; hop < MAX_SYMLINK_HOPS; hop += 1) {
    let link: string;
    try {
      link = await fs.readlink(current);
    } catch {
      return current;
    }
    current = path.resolve(path.dirname(current), link);
  }
  return current;
}

/** Symlink hops followed before a chain is called a loop (mirrors atomic-write.ts). */
const MAX_SYMLINK_HOPS = 40;
