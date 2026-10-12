/**
 * Reading a data root's server instance lock (`<root>/server.lock`).
 *
 * web.db is single-process / single-writer, and two servers on one data root would also
 * double-run the schedule scheduler — so a data root admits one server at a time. The lock
 * records {pid, port, startedAt, version}; liveness requires BOTH the pid to be alive AND the
 * recorded port to accept a TCP connection, because either signal alone false-positives (pids
 * get recycled, ports get taken by unrelated processes). A lock that fails the liveness check
 * is stale and is simply overwritten by the next server.
 *
 * The reader lives in core because core itself has to ask who holds a root: a one-time
 * migration of a file in it is not written back while an older server serves that root
 * (migration-write-back.ts). Only the server writes the lock; the writer stays in the server
 * package, whose `@prismshadow/penguin-server/lock` re-exports this module. Published on its own
 * as `@prismshadow/penguin-core/server-lock`, side-effect-free and free of the SDK barrel, so that
 * re-export costs the CLI and the desktop shell nothing at startup.
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

export interface ServerLock {
  pid: number;
  port: number;
  startedAt: string;
  /**
   * The core VERSION of the server that wrote the lock, a release number. Absent in a lock left
   * by a server that predates the field; readers treat that server as older than any that
   * records one.
   */
  version?: string;
}

/** TCP probe budget: loopback either connects immediately or the port is dead. */
const PROBE_TIMEOUT_MS = 500;

export function serverLockPath(root: string): string {
  return path.join(root, "server.lock");
}

/**
 * The lock's text, parsed; anything that is not one reads as "no lock". Lenient about
 * `version`: a missing or non-string value leaves it out rather than rejecting the lock.
 *
 * Exported for a reader that holds the lock's text rather than the file — a lock read on
 * another machine comes back as text — so that the shape is defined once and readers cannot
 * drift apart.
 */
export function parseServerLock(raw: string): ServerLock | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ServerLock>;
    if (
      typeof parsed.pid !== "number" ||
      !Number.isInteger(parsed.pid) ||
      typeof parsed.port !== "number" ||
      !Number.isInteger(parsed.port)
    ) {
      return null;
    }
    const version = typeof parsed.version === "string" ? parsed.version.trim() : "";
    return {
      pid: parsed.pid,
      port: parsed.port,
      startedAt: String(parsed.startedAt ?? ""),
      ...(version !== "" ? { version } : {}),
    };
  } catch {
    return null;
  }
}

/** Reads the lock file; a missing or malformed file reads as "no lock". */
export function readServerLock(root: string): ServerLock | null {
  try {
    return parseServerLock(fs.readFileSync(serverLockPath(root), "utf8"));
  } catch {
    return null;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = the process exists but belongs to another user — still alive.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function portAccepts(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    // 127.0.0.1 rather than localhost: this is a raw TCP liveness probe, not an App
    // request, and the server binds 127.0.0.1 (plus ::1) on loopback setups.
    const socket = net.connect({ host: "127.0.0.1", port, timeout: PROBE_TIMEOUT_MS });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

/** True when the lock's process is alive AND its port accepts connections. */
export async function isServerLockAlive(lock: ServerLock): Promise<boolean> {
  return pidAlive(lock.pid) && (await portAccepts(lock.port));
}

/** Convenience for pre-checks: the live lock on this root, or null (absent or stale). */
export async function liveServerLock(root: string): Promise<ServerLock | null> {
  const lock = readServerLock(root);
  if (lock === null) return null;
  return (await isServerLockAlive(lock)) ? lock : null;
}
