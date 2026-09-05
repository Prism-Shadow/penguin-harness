/**
 * Offline rescue for a forgotten admin password — nobody can reset the admin from the web UI,
 * so this does it from the machine that owns the data root (local filesystem access IS the
 * authorization). The account goes back to unclaimed and the next start prints a first-login
 * link, so no plaintext is produced for anyone to write down. Refuses while a server is live,
 * web.db being single-writer. Exported as `@prismshadow/penguin-server/reset-admin-password`
 * so the CLI need not import the package entry, which starts listening.
 */
import fs from "node:fs";
import path from "node:path";
import { hashPassword } from "./auth/password.js";
import { ADMIN_USER_ID, generateInitialAdminPassword } from "./auth/service.js";
import { openDatabase } from "./db/database.js";
import { UsersRepo } from "./db/repos/users.js";
import { AuthSessionsRepo } from "./db/repos/auth-sessions.js";
import { clearInitialAdminPassword } from "./initial-password.js";
import { liveServerLock } from "./lock.js";
import type { ServerLock } from "./lock.js";
import { wire } from "@prismshadow/penguin-core/kernel";

export type ResetAdminPasswordResult =
  /** Refused: a live server owns this data root (stop it first — web.db is single-writer). */
  | { outcome: "server_running"; lock: ServerLock }
  /** Nothing to reset: the root has no Web database (the server has never run here). */
  | { outcome: "no_database"; dbPath: string }
  /** Nothing to reset: the database exists but the admin was never seeded. */
  | { outcome: "no_admin" }
  /** Returned to the unclaimed state: start the server and open the first-login link it prints. */
  | { outcome: "reset" };

/** `dbPath` may be elsewhere (PENGUIN_WEB_DB); `root` stays the root, which the sweep needs. */
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
    const users = wire(UsersRepo, { db: db });
    if (users.findById(ADMIN_USER_ID) === null) return { outcome: "no_admin" };
    // Discarded unread: a value nobody holds cannot be typed, phished, or left in a buffer.
    const password = generateInitialAdminPassword();
    users.updatePassword(ADMIN_USER_ID, await hashPassword(password), true);
    wire(AuthSessionsRepo, { db: db }).deleteByUser(ADMIN_USER_ID);
    clearInitialAdminPassword(root);
    return { outcome: "reset" };
  } finally {
    db.close();
  }
}
