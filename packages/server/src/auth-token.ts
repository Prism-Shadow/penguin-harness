/**
 * Mints an API session by inserting a row into the root's `web.db` — no running server needed.
 * Authorized by being able to read and write that root, which already holds every credential
 * the token could reach. On a multi-user box that means the OS account running the server;
 * everyone else signs in with `penguin auth login --server <url>`.
 */
import path from "node:path";
import fs from "node:fs";
import { openExistingDatabase } from "./db/database.js";
import { AuthSessionsRepo } from "./db/repos/auth-sessions.js";
import type { SessionViaValue } from "./db/repos/auth-sessions.js";
import { UsersRepo } from "./db/repos/users.js";
import { wire } from "@prismshadow/penguin-core/kernel";

/** An hour: long enough for a controller to finish, short enough to forget. */
export const CLI_TOKEN_TTL_MS = 60 * 60_000;

/**
 * Ceiling on a caller-supplied `--ttl-seconds`, matching the default session TTL (config.ts):
 * a token that lives in a file must not outlive an ordinary browser session.
 */
export const CLI_TOKEN_MAX_TTL_MS = 30 * 24 * 60 * 60_000;

/**
 * What a minted row records about how its session was established.
 *
 * `cli` is the default and what `penguin auth token` writes: a session that behaves like a
 * password one in every way. `desktop` is for the desktop shell signing its own window in
 * against a server it did not spawn, and says the same thing its one-shot claim token says —
 * with as much backing, since only an account that can write this file can mint at all.
 *
 * The distinction is not cosmetic: a desktop session may set a password without supplying the
 * current one, because the account the shell created has a password that was generated,
 * hashed and discarded unseen — there is nothing to supply, and whoever can write to this
 * data root can already reset that password offline (`penguin server reset-admin-password`).
 * That allowance is granted by a server running in desktop mode; against any other server the
 * value records what the session is without widening what it may do (routes/me.ts).
 */
export type MintedVia = Extract<SessionViaValue, "cli" | "desktop">;

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
  opts: {
    userId?: string;
    ttlMs?: number;
    dbPath?: string;
    now?: Date;
    /** How the session records its own establishment; `cli` unless told otherwise. */
    via?: MintedVia;
  } = {},
): MintTokenResult {
  const userId = opts.userId ?? "admin";
  const dbPath = opts.dbPath ?? path.join(root, "web.db");
  // Existence check first: openExistingDatabase would otherwise create an empty file, and a
  // root with no web.db has no account to mint for.
  if (!fs.existsSync(dbPath)) return { outcome: "no_server" };

  let db: ReturnType<typeof openExistingDatabase> | null = null;
  try {
    db = openExistingDatabase(dbPath);
    if (wire(UsersRepo, { db: db }).findById(userId) === null) {
      return { outcome: "failed", detail: `no such account: ${userId}` };
    }
    // The repo is the single minting point (token shape, hash, TTL ceiling), so a CLI-minted
    // row cannot drift from one the server issues itself.
    const { token, expiresAt } = wire(AuthSessionsRepo, { db: db }).issue({
      userId,
      via: opts.via ?? "cli",
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
