/**
 * Offline admin-password reset — the rescue path when the Web admin password is
 * forgotten (`penguin server reset-admin-password`).
 *
 * The admin can reset every OTHER user from the user-management page, but nobody can reset
 * the admin itself once its password is lost. This module closes that gap from the machine
 * that owns the data root: it returns the account to the UNCLAIMED state — a random password
 * nobody has ever seen, flagged password_is_initial, with every one of the admin's sessions
 * revoked. The next server start then prints a first-login link, exactly as a fresh install
 * does, and claiming it sets a real password.
 *
 * No plaintext is produced or stored, so there is nothing for the caller to write down and
 * nothing left on disk afterwards. The rescue is "start the server and open the link".
 *
 * web.db is single-process / single-writer (see db/database.ts and lock.ts), so the
 * reset refuses while a live server owns the root: the caller tells the user to stop it
 * first. Requiring local filesystem access is the authorization model — whoever can run
 * this already owns the SQLite database sitting next to the file it writes.
 *
 * Published as `@prismshadow/penguin-server/reset-admin-password` (side-effect-free,
 * like ./lock) so the CLI can run the reset without importing the package entry, which
 * starts listening.
 */
import fs from "node:fs";
import path from "node:path";
import { hashPassword } from "./auth/password.js";
import { ADMIN_USER_ID, generateInitialAdminPassword } from "./auth/service.js";
import { openDatabase } from "./db/database.js";
import { UsersRepo } from "./db/repos/users.js";
import { clearInitialAdminPassword } from "./initial-password.js";
import { liveServerLock } from "./lock.js";
import type { ServerLock } from "./lock.js";

export type ResetAdminPasswordResult =
  /** Refused: a live server owns this data root (stop it first — web.db is single-writer). */
  | { outcome: "server_running"; lock: ServerLock }
  /** Nothing to reset: the root has no Web database (the server has never run here). */
  | { outcome: "no_database"; dbPath: string }
  /** Nothing to reset: the database exists but the admin was never seeded. */
  | { outcome: "no_admin" }
  /** Returned to the unclaimed state: start the server and open the first-login link it prints. */
  | { outcome: "reset" };

/**
 * Returns the built-in admin to the unclaimed state. `dbPath` defaults to the root's
 * `web.db`; callers honoring PENGUIN_WEB_DB pass the resolved path, while `root` stays the
 * root itself — the sweep below is addressed to the root's own layout, not to the database.
 */
export async function resetAdminPassword(
  root: string,
  dbPath: string = path.join(root, "web.db"),
): Promise<ResetAdminPasswordResult> {
  const lock = await liveServerLock(root);
  if (lock !== null) return { outcome: "server_running", lock };
  // Existence check before openDatabase, which would otherwise CREATE an empty database
  // (and the root directory) on a root the server has never used.
  if (!fs.existsSync(dbPath)) return { outcome: "no_database", dbPath };
  const db = openDatabase(dbPath);
  try {
    const users = new UsersRepo(db);
    if (users.findById(ADMIN_USER_ID) === null) return { outcome: "no_admin" };
    // Random and discarded: the account is being returned to "never claimed", and the
    // first-login link is what claims it. A value nobody holds cannot be typed, phished,
    // or left in a terminal buffer.
    const password = generateInitialAdminPassword();
    users.updatePassword(ADMIN_USER_ID, await hashPassword(password), true);
    // Works offline because the server reads the mark per request: every token issued to the
    // admin before this instant stops verifying the moment it comes back up.
    users.setSessionsNotBefore(ADMIN_USER_ID, new Date().toISOString());
    // Nothing writes it any more; sweep a plaintext an older build may have left behind.
    clearInitialAdminPassword(root);
    return { outcome: "reset" };
  } finally {
    db.close();
  }
}
