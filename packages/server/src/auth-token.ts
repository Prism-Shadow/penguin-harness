/**
 * Minting a short-lived API session from the machine's own disk, for whoever is already on it.
 *
 * WHAT AUTHORIZES IT is the ability to read AND write the data root: a session is a row in
 * `web.db`, so this opens the database and inserts one — no running server, no owner token, no
 * loopback hop. Reading the root already reaches every credential the token could, so the
 * write adds no authority it did not have. `via: "cli"` reads as an ordinary password session.
 *
 * That scoping is the point on a MULTI-USER deployment: the data root belongs to the OS
 * account running the server, so only that account (the machine's operator) can mint — for
 * any PenguinHarness account, which changing the database directly already allowed. Everyone
 * else signs in with their password: `penguin auth login --server <url>`.
 *
 * Safe to run while the server is up: web.db is WAL with a busy timeout (db/database.ts), so
 * the insert waits for the write lock rather than failing, and the server sees the row on its
 * next request (sessions are not cached — the row IS the session).
 */
import path from "node:path";
import fs from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { openDatabase } from "./db/database.js";
import { AuthSessionsRepo } from "./db/repos/auth-sessions.js";
import { UsersRepo } from "./db/repos/users.js";

/** An hour, matching what a controller needs: long enough to finish, short enough to forget. */
export const CLI_TOKEN_TTL_MS = 60 * 60_000;

export type MintTokenResult =
  | { outcome: "minted"; token: string; userId: string; expiresAt: string }
  /** No web.db on this root — the server has never run here, so there is no account to sign for. */
  | { outcome: "no_server" }
  | { outcome: "failed"; detail: string };

/** Issues an API session token for the data root at `root`. */
export function mintApiToken(
  root: string,
  opts: { userId?: string; ttlMs?: number; dbPath?: string } = {},
): MintTokenResult {
  const userId = opts.userId ?? "admin";
  const ttlMs = opts.ttlMs ?? CLI_TOKEN_TTL_MS;
  const dbPath = opts.dbPath ?? path.join(root, "web.db");

  // Existence check before openDatabase, which would otherwise CREATE an empty database (and
  // seed nothing): a root with no web.db has no admin to mint for.
  if (!fs.existsSync(dbPath)) return { outcome: "no_server" };

  // A database this OS account cannot open is the multi-user case, not a crash: minting is
  // for the data root's owner, and anyone else has a password to log in with instead.
  let db: ReturnType<typeof openDatabase>;
  try {
    db = openDatabase(dbPath);
  } catch (err) {
    return {
      outcome: "failed",
      detail:
        `cannot open ${dbPath} (${err instanceof Error ? err.message : String(err)}) — ` +
        "minting needs the data root's own OS account; otherwise sign in with " +
        "`penguin auth login --server <url>`",
    };
  }
  try {
    if (new UsersRepo(db).findById(userId) === null) {
      return { outcome: "failed", detail: `no such account: ${userId}` };
    }
    const token = randomBytes(32).toString("base64url");
    const now = Date.now();
    const expiresAt = new Date(now + ttlMs).toISOString();
    new AuthSessionsRepo(db).insert({
      tokenHash: createHash("sha256").update(token).digest("hex"),
      userId,
      createdAt: new Date(now).toISOString(),
      expiresAt,
      via: "cli",
    });
    return { outcome: "minted", token, userId, expiresAt };
  } catch (err) {
    return { outcome: "failed", detail: err instanceof Error ? err.message : String(err) };
  } finally {
    db.close();
  }
}
