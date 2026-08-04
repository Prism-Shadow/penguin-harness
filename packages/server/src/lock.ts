/**
 * Root-level server instance lock (`<root>/server.lock`).
 *
 * web.db is single-process / single-writer (see db/database.ts), and two servers on one
 * data root would also double-run the schedule scheduler — so a data root admits one
 * server at a time. The lock records {pid, port, startedAt}; liveness requires BOTH the
 * pid to be alive AND the recorded port to accept a TCP connection, because either signal
 * alone false-positives (pids get recycled, ports get taken by unrelated processes). A
 * lock that fails the liveness check is stale and is simply overwritten by the next
 * server.
 *
 * Published as `@prismshadow/penguin-server/lock` (side-effect-free) so the CLI and the
 * desktop shell can pre-check a root without importing the package entry, which starts
 * listening. Docs: design § "桌面端原型 · 数据根与实例互斥".
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

/** Reads the lock file; a missing or malformed file reads as "no lock". */
export function readServerLock(root: string): ServerLock | null {
  let raw: string;
  try {
    raw = fs.readFileSync(serverLockPath(root), "utf8");
  } catch {
    return null;
  }
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

/** Writes the lock atomically (tmp + rename; the parent directory must already exist). */
export function acquireServerLock(root: string, lock: ServerLock): void {
  const target = serverLockPath(root);
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(lock) + "\n");
  fs.renameSync(tmp, target);
}

/** Removes the lock if it is still ours (best-effort; never throws on shutdown paths). */
export function releaseServerLock(root: string): void {
  try {
    const lock = readServerLock(root);
    if (lock && lock.pid === process.pid) fs.rmSync(serverLockPath(root));
  } catch {
    // Best-effort: a stale leftover is overwritten by the next server anyway.
  }
}
