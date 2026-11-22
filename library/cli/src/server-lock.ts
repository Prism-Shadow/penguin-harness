/**
 * Reading the root-level server instance lock (`<root>/server.lock`): what a client needs to
 * find the server running on a data root. The server writes and releases the lock
 * (`@prismshadow/penguin-server/lock`, which re-exports this reader beside its writer); the CLI's
 * connection resolution and the desktop shell read it.
 *
 * The lock records {pid, port, startedAt}; liveness requires BOTH the pid to be alive AND the
 * recorded port to accept a TCP connection, because either signal alone false-positives (pids
 * get recycled, ports get taken by unrelated processes). A lock that fails the liveness check
 * is stale.
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

export interface ServerLock {
  pid: number;
  port: number;
  startedAt: string;
}

/** TCP probe budget: loopback either connects immediately or the port is dead. */
const PROBE_TIMEOUT_MS = 500;

export function serverLockPath(root: string): string {
  return path.join(root, "server.lock");
}

/**
 * The lock's text, parsed; anything that is not one reads as "no lock".
 *
 * Exported because a lock is also read where the file is not: a controller looking at
 * ANOTHER machine gets this same text back from an ssh `cat` (machines/server-state.ts). The
 * shape is defined once here so the two readers cannot drift apart.
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
    return { pid: parsed.pid, port: parsed.port, startedAt: String(parsed.startedAt ?? "") };
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
  if (!lock) return null;
  return (await isServerLockAlive(lock)) ? lock : null;
}
