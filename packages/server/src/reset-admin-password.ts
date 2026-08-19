/**
 * Offline admin-password reset — the rescue path when the Web admin password is
 * forgotten (`penguin server reset-admin-password`).
 *
 * The admin can reset every OTHER user from the user-management page, but nobody can
 * reset the admin itself once its password is lost: the plaintext file in the data root
 * only survives while the password is still the initial one. This module closes that
 * gap from the machine that owns the data root: it re-arms the whole initial-password
 * machinery — a fresh `penguin-<4 digits>` password flagged password_is_initial, the
 * plaintext stored via initial-password.ts so every server start re-prints the framed
 * reminder until the password is changed, and all of the admin's login sessions
 * cleared (matching an admin-initiated reset).
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
import { AuthSessionsRepo } from "./db/repos/auth-sessions.js";
import { UsersRepo } from "./db/repos/users.js";
import { storeInitialAdminPassword } from "./initial-password.js";
import { liveServerLock } from "./lock.js";
import type { ServerLock } from "./lock.js";

export type ResetAdminPasswordResult =
  /** Refused: a live server owns this data root (stop it first — web.db is single-writer). */
  | { outcome: "server_running"; lock: ServerLock }
  /** Nothing to reset: the root has no Web database (the server has never run here). */
  | { outcome: "no_database"; dbPath: string }
  /** Nothing to reset: the database exists but the admin was never seeded. */
  | { outcome: "no_admin" }
  | { outcome: "reset"; password: string };

/**
 * Resets the built-in admin to a fresh initial password. `dbPath` defaults to the
 * root's `web.db`; callers honoring PENGUIN_WEB_DB pass the resolved path (the
 * plaintext reminder file always lives in `root`, matching the server's own layout).
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
    const password = generateInitialAdminPassword();
    users.updatePassword(ADMIN_USER_ID, await hashPassword(password), true);
    new AuthSessionsRepo(db).deleteByUser(ADMIN_USER_ID);
    storeInitialAdminPassword(root, password);
    return { outcome: "reset", password };
  } finally {
    db.close();
  }
}
