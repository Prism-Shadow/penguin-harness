/**
 * Minting a short-lived API session from the machine's own disk, for whoever is already on it.
 *
 * A machine is a separate server with its own accounts, so a controller reaching its API needs
 * a session there. Obtaining one used to mean reading that machine's SEEDED admin password off
 * its disk and logging in over loopback (machines/signin.ts) — which works only until somebody
 * changes that password, and then never again. That is not a rare state; it is what a person
 * setting up a machine properly does.
 *
 * WHAT AUTHORIZES THIS. Not a password: the ssh account's access to the data root. Whoever can
 * run this can already read `web.db`, every Session's trace, and every Project's inlined
 * credentials — a token adds nothing they did not have. It only makes that access usable
 * through the API instead of by hand.
 *
 * STATELESS. Sessions are signed statements (auth/token-codec.ts), so minting is reading the
 * root's signing key and computing a signature — no database open, no row, nothing racing the
 * live server. That is also what lets this work on a root whose server is down, or has never
 * run: the key is created on first use, and the server adopts the same file at its next boot.
 *
 * The claims record `v: "cli"`. Nothing grants privilege from it — verification maps anything
 * that is not "desktop" to an ordinary password session, so a token minted here can never
 * reach the desktop-only routes.
 */
import fs from "node:fs";
import path from "node:path";
import { readOrCreateAuthSecret } from "./auth/token-secret.js";
import { newClaims, signToken } from "./auth/token-codec.js";

/** An hour, matching what a controller needs: long enough to finish, short enough to forget. */
export const CLI_TOKEN_TTL_MS = 60 * 60_000;

export type MintTokenResult =
  | { outcome: "minted"; token: string; userId: string; expiresAt: string }
  | { outcome: "no_user"; userId: string };

/**
 * Issues a signed API token against the data root at `root`.
 *
 * The user check is a COURTESY, not the enforcement — verification looks the account up on
 * every request, so a token for a user that never appears simply never authenticates. It runs
 * only when a database is already there to ask: on a fresh root (no web.db yet) the token is
 * minted anyway, for the admin the first boot will seed.
 */
export function mintApiToken(
  root: string,
  opts: { userId?: string; ttlMs?: number; now?: () => Date } = {},
): MintTokenResult {
  const userId = opts.userId ?? "admin";
  const dbPath = process.env.PENGUIN_WEB_DB ?? path.join(root, "web.db");
  if (fs.existsSync(dbPath) && !userExists(dbPath, userId)) {
    return { outcome: "no_user", userId };
  }
  const now = opts.now?.() ?? new Date();
  const claims = newClaims(userId, "cli", now.getTime(), opts.ttlMs ?? CLI_TOKEN_TTL_MS);
  return {
    outcome: "minted",
    token: signToken(claims, readOrCreateAuthSecret(root)),
    userId,
    expiresAt: new Date(claims.exp).toISOString(),
  };
}

/** One read-only question to an existing database; an unopenable one answers "unknown", not "no". */
function userExists(dbPath: string, userId: string): boolean {
  try {
    // Deferred import shape: node:sqlite is experimental and this module must stay importable
    // where only minting (no validation) is needed.
    const sqlite = process.getBuiltinModule("node:sqlite");
    const db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
    try {
      return db.prepare("SELECT 1 FROM users WHERE user_id = ?").get(userId) !== undefined;
    } finally {
      db.close();
    }
  } catch {
    return true; // Unreadable database: mint, and let verification be the judge.
  }
}
