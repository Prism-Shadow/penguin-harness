/**
 * Whether a server holds the data root, read the way the server's own lock module reads it
 * (`packages/server/src/lock.ts`, which owns the file's format): `<root>/server.lock` names a pid
 * and a port, and the lock is live only when the process is alive AND its port accepts a
 * connection — either signal alone is wrong once pids are recycled or ports re-used. Core reads
 * the file itself because the SDK must not depend on the server package.
 *
 * Compatibility owner: core's `state/layout-migration/`, removed with the migration at 1.0.
 */
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function portAccepts(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port, timeout: 500 });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

/** The pid of the live server holding `root`, or null when none does (no lock, or a stale one). */
export async function serverHoldingRoot(root: string): Promise<number | null> {
  let lock: { pid?: unknown; port?: unknown };
  try {
    lock = JSON.parse(await fs.readFile(path.join(root, "server.lock"), "utf8")) as typeof lock;
  } catch {
    return null;
  }
  const { pid, port } = lock;
  if (typeof pid !== "number" || !Number.isInteger(pid)) return null;
  if (typeof port !== "number" || !Number.isInteger(port)) return null;
  return pidAlive(pid) && (await portAccepts(port)) ? pid : null;
}
