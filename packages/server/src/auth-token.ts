/**
 * Minting a short-lived API session from the machine's own disk, for whoever is already on it.
 *
 * WHAT AUTHORIZES IT is the ability to read AND write the data root: a session is a row in
 * `web.db`, so this opens the database and inserts one — no running server, no loopback hop.
 * Reading the root already reaches every credential the token could, so the write adds no
 * authority it did not have. `via: "cli"` reads as an ordinary password session.
 *
 * That scoping is the point on a MULTI-USER deployment: the data root belongs to the OS
 * account running the server, so only that account (the machine's operator) can mint — for
 * any PenguinHarness account, which changing the database directly already allowed. Everyone
 * else signs in with their password: `penguin auth login --server <url>`.
 */
import path from "node:path";
import fs from "node:fs";
import { openExistingDatabase } from "./db/database.js";
import { AuthSessionsRepo } from "./db/repos/auth-sessions.js";
import { UsersRepo } from "./db/repos/users.js";

/** An hour, matching what a controller needs: long enough to finish, short enough to forget. */
export const CLI_TOKEN_TTL_MS = 60 * 60_000;

/**
 * Ceiling on a caller-supplied `--ttl-seconds`, matching the default session TTL (config.ts):
 * a token that lives in a file must not outlive an ordinary browser session.
 */
export const CLI_TOKEN_MAX_TTL_MS = 30 * 24 * 60 * 60_000;

export type MintTokenResult =
  | { outcome: "minted"; token: string; userId: string; expiresAt: string }
  /** No web.db on this root — the server has never run here, so there is no account to mint for. */
  | { outcome: "no_server" }
  | { outcome: "failed"; detail: string };

/**
 * Turns a failure into something the person at the terminal can act on. Both cases are
 * ordinary situations, not crashes: a database owned by another OS account, and one written
 * by an older release (minting deliberately does not migrate — see openExistingDatabase).
 */
function explain(err: unknown, dbPath: string): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("no column named via")) {
    return `${dbPath} predates this release — start the server once (\`penguin web\`) to upgrade it`;
  }
  if (message.includes("unable to open database")) {
    return (
      `cannot open ${dbPath} — minting needs the data root's own OS account; ` +
      "otherwise sign in with `penguin auth login --server <url>`"
    );
  }
  return message;
}

/** Issues an API session token for the data root at `root`. */
export function mintApiToken(
  root: string,
  opts: { userId?: string; ttlMs?: number; dbPath?: string; now?: Date } = {},
): MintTokenResult {
  const userId = opts.userId ?? "admin";
  const dbPath = opts.dbPath ?? path.join(root, "web.db");
  // Existence check first: openExistingDatabase would otherwise create an empty file, and a
  // root with no web.db has no account to mint for.
  if (!fs.existsSync(dbPath)) return { outcome: "no_server" };

  let db: ReturnType<typeof openExistingDatabase> | null = null;
  try {
    db = openExistingDatabase(dbPath);
    if (new UsersRepo(db).findById(userId) === null) {
      return { outcome: "failed", detail: `no such account: ${userId}` };
    }
    // The repo is the single minting point (token shape, hash, TTL ceiling), so a CLI-minted
    // row cannot drift from one the server issues itself.
    const { token, expiresAt } = new AuthSessionsRepo(db).issue({
      userId,
      via: "cli",
      now: opts.now ?? new Date(),
      ttlMs: opts.ttlMs ?? CLI_TOKEN_TTL_MS,
      maxTtlMs: CLI_TOKEN_MAX_TTL_MS,
    });
    return { outcome: "minted", token, userId, expiresAt };
  } catch (err) {
    return { outcome: "failed", detail: explain(err, dbPath) };
  } finally {
    db?.close();
  }
}
