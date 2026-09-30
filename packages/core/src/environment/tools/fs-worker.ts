/**
 * The file tools' sandboxed helper: a Node process the Session's sandbox confines exactly
 * as it confines a command, serving the {@link FsPort} primitives over one JSON line per
 * request on stdin and one per answer on stdout (binary as base64). Every file-system
 * effect of read_file, edit_file and write_file happens inside it when a Session is
 * confined, so the backend that bounds the Session's commands bounds its file tools too —
 * one policy, one enforcer, and nothing for the harness to re-implement.
 *
 * The helper's program travels as a `-e` argument, so no file has to be shipped beside any
 * bundle that inlines core; it uses only builtin modules and syntax an older Node in a
 * sandbox distro understands. One helper serves a Session, started at its first confined
 * file operation and kept for the next ones; it is started over when the confiner's answer
 * changes (the policy was edited), after a crash, and after an abort, which kills it so an
 * operation the sandbox is stalling cannot outlive the call.
 *
 * Paths cross as the host spells them. Inside a Linux distro serving a Windows host (the
 * WSL backend), a drive path is mapped to its `/mnt/<drive>` spelling on the way in and
 * back on the way out, so the tools never see the distro's view.
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import readline from "node:readline";
import type { ConfinedSpawn } from "../../interfaces/index.js";
import type { FsDirent, FsFetchResult, FsStat, ToolFs } from "./fs-port.js";

/**
 * The helper's program (CommonJS, builtin modules only — the same shape a hook script
 * has). Ops answer with JSON-serializable results; buffers travel base64. Windows drive
 * paths are mapped for a Linux distro and unmapped in answers that carry paths.
 */
export const FS_WORKER_SOURCE = String.raw`
const fs = require("node:fs/promises");
const path = require("node:path");
const readline = require("node:readline");
const linux = process.platform !== "win32";
const DRIVE = /^([A-Za-z]):[\\/](.*)$/;
function toLocal(p) {
  const m = linux ? DRIVE.exec(p) : null;
  if (!m) return p;
  const rest = m[2].split(/[\\/]+/).filter(Boolean);
  return ["/mnt/" + m[1].toLowerCase()].concat(rest).join("/");
}
function fromLocal(p, like) {
  if (!linux || !DRIVE.test(like)) return p;
  const m = /^\/mnt\/([a-z])(?:\/(.*))?$/.exec(p);
  if (!m) return p;
  return m[1].toUpperCase() + ":\\" + (m[2] || "").split("/").join("\\");
}
async function writeAtomic(target, content, mode, followSymlinks) {
  let dest = target;
  if (followSymlinks) {
    for (let hop = 0; hop < 40; hop += 1) {
      let link;
      try {
        link = await fs.readlink(dest);
      } catch {
        break;
      }
      dest = path.resolve(path.dirname(dest), link);
    }
  }
  const tmp = path.join(
    path.dirname(dest),
    "." + path.basename(dest) + ".tmp-" + process.pid + "-" + Math.random().toString(36).slice(2, 8),
  );
  try {
    await fs.writeFile(tmp, content, mode === undefined ? { flush: true } : { mode, flush: true });
    if (mode !== undefined) await fs.chmod(tmp, mode);
    await fs.rename(tmp, dest);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}
const ops = {
  async stat({ p }) {
    const s = await fs.stat(toLocal(p));
    return { isFile: s.isFile(), isDirectory: s.isDirectory(), size: s.size, mode: s.mode };
  },
  async readFile({ p }) {
    return (await fs.readFile(toLocal(p))).toString("base64");
  },
  async readRange({ p, position, length }) {
    const fh = await fs.open(toLocal(p), "r");
    try {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await fh.read(buf, 0, length, position);
      return buf.subarray(0, bytesRead).toString("base64");
    } finally {
      await fh.close();
    }
  },
  async readdir({ p }) {
    const entries = await fs.readdir(toLocal(p), { withFileTypes: true });
    return entries.map((e) => ({ name: e.name, isFile: e.isFile(), isDirectory: e.isDirectory() }));
  },
  async realpath({ p }) {
    return fromLocal(await fs.realpath(toLocal(p)), p);
  },
  async readlink({ p }) {
    return fromLocal(await fs.readlink(toLocal(p)), p);
  },
  async mkdir({ p }) {
    await fs.mkdir(toLocal(p), { recursive: true });
  },
  async writeFileAtomic({ p, content, mode, followSymlinks }) {
    await writeAtomic(toLocal(p), Buffer.from(content, "base64"), mode, followSymlinks === true);
  },
  async fetch({ url, maxBytes }) {
    const res = await fetch(url);
    const declared = Number(res.headers.get("content-length") || "");
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw Object.assign(new Error("response body of " + declared + " bytes exceeds the limit"), { code: "ETOOBIG", size: declared });
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > maxBytes) {
      throw Object.assign(new Error("response body of " + bytes.length + " bytes exceeds the limit"), { code: "ETOOBIG", size: bytes.length });
    }
    return { ok: res.ok, status: res.status, contentType: res.headers.get("content-type"), bytes: bytes.toString("base64") };
  },
};
const out = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
readline.createInterface({ input: process.stdin, terminal: false }).on("line", (line) => {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }
  const op = ops[req.op];
  if (!op) {
    out({ id: req.id, ok: false, error: { code: "ENOSYS", message: "unknown op " + req.op } });
    return;
  }
  op(req.args || {}).then(
    (result) => out({ id: req.id, ok: true, result: result === undefined ? null : result }),
    (err) => out({ id: req.id, ok: false, error: { code: err && err.code, message: err && err.message ? err.message : String(err), size: err && err.size } }),
  );
});
process.stdin.on("end", () => process.exit(0));
`;

/** The argv the helper is spawned as, before the confiner rewrites it. */
export function fsWorkerArgv(): string[] {
  return [process.execPath, "-e", FS_WORKER_SOURCE];
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

/** One running helper: the confiner's answer it was started from, its process and the requests in flight. */
interface Worker {
  key: string;
  child: ChildProcess;
  pending: Map<number, Pending>;
  exited: boolean;
}

/**
 * The Session's helper, started on demand and kept until `dispose`. `portFor` answers a
 * port over the helper the confiner's answer describes, starting one when none runs or the
 * running one was started from a different answer.
 */
export class SandboxedFsHost {
  private worker: Worker | null = null;
  private nextId = 1;
  private disposed = false;

  constructor(private readonly spawnWorker: (spawn: ConfinedSpawn) => ChildProcess = start) {}

  /** A port over a helper started from `confined` (the confiner's answer for the helper argv). */
  portFor(confined: ConfinedSpawn): ToolFs {
    const key = JSON.stringify([confined.argv, confined.env ?? null]);
    const request = (op: string, args: Record<string, unknown>, signal?: AbortSignal) =>
      this.request(key, confined, op, args, signal);
    const buffer = async (op: string, args: Record<string, unknown>): Promise<Buffer> =>
      Buffer.from((await request(op, args)) as string, "base64");
    return {
      sandboxed: true,
      stat: (p) => request("stat", { p }) as Promise<FsStat>,
      readFile: (p) => buffer("readFile", { p }),
      readRange: (p, position, length) => buffer("readRange", { p, position, length }),
      readdir: (p) => request("readdir", { p }) as Promise<FsDirent[]>,
      realpath: (p) => request("realpath", { p }) as Promise<string>,
      readlink: (p) => request("readlink", { p }) as Promise<string>,
      mkdir: async (p) => {
        await request("mkdir", { p });
      },
      writeFileAtomic: async (p, content, opts) => {
        await request("writeFileAtomic", {
          p,
          content: content.toString("base64"),
          ...(opts.mode !== undefined ? { mode: opts.mode } : {}),
          ...(opts.followSymlinks !== undefined ? { followSymlinks: opts.followSymlinks } : {}),
        });
      },
      fetch: async (url, opts) => {
        const answer = (await request("fetch", { url, maxBytes: opts.maxBytes }, opts.signal)) as {
          ok: boolean;
          status: number;
          contentType: string | null;
          bytes: string;
        };
        return { ...answer, bytes: Buffer.from(answer.bytes, "base64") } satisfies FsFetchResult;
      },
    };
  }

  /** Whether a helper is running right now (for tests and diagnostics). */
  get running(): boolean {
    return this.worker !== null && !this.worker.exited;
  }

  /** Stops the helper; the next port request starts a fresh one. */
  dispose(): void {
    this.disposed = true;
    this.stop(new Error("the file helper was disposed"));
  }

  private request(
    key: string,
    confined: ConfinedSpawn,
    op: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (this.disposed) return Promise.reject(new Error("the file helper was disposed"));
    if (signal?.aborted) return Promise.reject(abortError());
    const worker = this.ensure(key, confined);
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const onAbort = (): void => {
        // The sandbox may be stalling the operation; the helper goes with the call.
        this.stop(abortError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      worker.pending.set(id, {
        resolve: (value) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(value);
        },
        reject: (err) => {
          signal?.removeEventListener("abort", onAbort);
          reject(err);
        },
      });
      worker.child.stdin!.write(`${JSON.stringify({ id, op, args })}\n`, (err) => {
        if (err) this.settle(worker, id, { ok: false, error: { message: err.message } });
      });
    });
  }

  /** The running helper for `key`, or a fresh one — the previous one, started from another answer or exited, is stopped. */
  private ensure(key: string, confined: ConfinedSpawn): Worker {
    if (this.worker !== null && (this.worker.key !== key || this.worker.exited)) {
      this.stop(new Error("the file helper was restarted"));
    }
    if (this.worker !== null) return this.worker;
    const child = this.spawnWorker(confined);
    const worker: Worker = { key, child, pending: new Map(), exited: false };
    let stderr = "";
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-2048);
    });
    readline.createInterface({ input: child.stdout!, terminal: false }).on("line", (line) => {
      let msg: { id?: number; ok?: boolean; result?: unknown; error?: WireError };
      try {
        msg = JSON.parse(line) as typeof msg;
      } catch {
        return;
      }
      if (typeof msg.id === "number") this.settle(worker, msg.id, msg);
    });
    const onGone = (reason: string): void => {
      if (worker.exited) return;
      worker.exited = true;
      const tail = stderr.trim();
      const err = new Error(tail ? `${reason}: ${tail}` : reason);
      for (const p of worker.pending.values()) p.reject(err);
      worker.pending.clear();
      if (this.worker === worker) this.worker = null;
    };
    child.on("error", (err) => onGone(`sandbox: the file helper could not start (${err.message})`));
    child.on("close", (code, signal) =>
      onGone(`sandbox: the file helper exited (${signal ?? `code ${code}`})`),
    );
    child.stdin?.on("error", () => {
      // A helper that died mid-write closes the pipe; `close` above reports it.
    });
    this.worker = worker;
    return worker;
  }

  /** Answers one request from the helper's reply. */
  private settle(
    worker: Worker,
    id: number,
    msg: { ok?: boolean; result?: unknown; error?: WireError },
  ): void {
    const pending = worker.pending.get(id);
    if (!pending) return;
    worker.pending.delete(id);
    if (msg.ok) {
      pending.resolve(msg.result);
      return;
    }
    const error = msg.error ?? {};
    pending.reject(
      Object.assign(new Error(error.message ?? "the file helper failed"), {
        ...(error.code !== undefined && error.code !== null ? { code: error.code } : {}),
        ...(error.size !== undefined && error.size !== null ? { size: error.size } : {}),
      }),
    );
  }

  /** Kills the helper and fails what it still owed. */
  private stop(reason: Error): void {
    const worker = this.worker;
    if (worker === null) return;
    this.worker = null;
    if (!worker.exited) {
      worker.exited = true;
      worker.child.kill("SIGKILL");
    }
    for (const p of worker.pending.values()) p.reject(reason);
    worker.pending.clear();
  }
}

interface WireError {
  code?: string | null;
  message?: string;
  size?: number | null;
}

function abortError(): Error {
  return Object.assign(new Error("aborted"), { name: "AbortError" });
}

/** Spawns the helper from the confiner's answer: the runner's entries over an environment that runs the desktop app's binary as Node. */
function start(confined: ConfinedSpawn): ChildProcess {
  const [program, ...args] = confined.argv;
  if (program === undefined) throw new Error("sandbox: the confiner returned an empty argv");
  return spawn(program, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...confined.env },
  });
}
