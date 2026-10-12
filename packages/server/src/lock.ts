/**
 * Root-level server instance lock (`<root>/server.lock`): the writer, plus the reader re-exported.
 *
 * A data root admits one server at a time (web.db is single-writer, and the scheduler must not
 * run twice). The lock records {pid, port, startedAt, version}; what counts as live, and how a
 * lock is parsed, is core's `@prismshadow/penguin-core/server-lock`, because core reads the lock
 * too: a one-time migration of a Project config is not written back while an older server holds
 * the root. Only a server writes it, so the writer stays here.
 *
 * Published as `@prismshadow/penguin-server/lock` (side-effect-free) so the CLI and the
 * desktop shell can pre-check a root without importing the package entry, which starts
 * listening. The core subpath it re-exports is side-effect-free as well, and does not load the
 * SDK barrel.
 */
import fs from "node:fs";
import {
  readServerLock,
  serverLockPath,
  type ServerLock,
} from "@prismshadow/penguin-core/server-lock";

export {
  isServerLockAlive,
  liveServerLock,
  parseServerLock,
  readServerLock,
  serverLockPath,
  type ServerLock,
} from "@prismshadow/penguin-core/server-lock";

/**
 * Writes the lock atomically (tmp + rename; the parent directory must already exist). Every
 * server records its core VERSION in `version`; the field is optional only so the readers stay
 * lenient about locks from servers that predate it.
 */
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
