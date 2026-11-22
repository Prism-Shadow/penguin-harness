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
 * listening. The reader lives in the CLI face (`@prismshadow/penguin-library-cli/server-lock`),
 * where the CLI's connection resolution reads it too; this module re-exports it beside the
 * writer, so the file's shape is defined once.
 */
import fs from "node:fs";
import {
  readServerLock,
  serverLockPath,
  type ServerLock,
} from "@prismshadow/penguin-library-cli/server-lock";

export {
  isServerLockAlive,
  liveServerLock,
  parseServerLock,
  readServerLock,
  serverLockPath,
  type ServerLock,
} from "@prismshadow/penguin-library-cli/server-lock";

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
