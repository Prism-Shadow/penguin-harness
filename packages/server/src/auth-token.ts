/**
 * Mints an API session by inserting a row into the root's `web.db` — no running server needed.
 * Authorized by being able to read and write that root, which already holds every credential
 * the token could reach. On a multi-user box that means the OS account running the server;
 * everyone else signs in with `penguin auth login --server <url>`.
 */
import path from "node:path";
import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { openExistingDatabase } from "./db/database.js";
import { AuthSessionsRepo } from "./db/repos/auth-sessions.js";
import type { SessionViaValue } from "./db/repos/auth-sessions.js";
import { UsersRepo } from "./db/repos/users.js";
import { liveServerLock } from "./lock.js";
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

/** What a mint is told by its caller. */
export interface MintTokenOptions {
  userId?: string;
  ttlMs?: number;
  dbPath?: string;
  now?: Date;
  /** How the session records its own establishment; `cli` unless told otherwise. */
  via?: MintedVia;
}

/** Issues an API session token for the data root at `root`. */
export function mintApiToken(root: string, opts: MintTokenOptions = {}): MintTokenResult {
  return attemptMint(root, opts).result;
}

/**
 * How long a mint waits for a starting server to create its accounts. A server seeds its
 * admin moments after its port binds (index.ts: plugins, the platform, then seedAdmin); this
 * covers a slow first boot with room to spare and is still well inside the 60s a controller's
 * shared shell gives one command.
 */
const SEED_WAIT_MS = 20_000;

/** How often the wait looks again: a reopen of web.db and a loopback probe, both cheap. */
const SEED_POLL_MS = 250;

/** The clock the wait runs on, a parameter so a test can make twenty seconds cost nothing. */
export interface SeedWait {
  now(): number;
  sleep(ms: number): Promise<void>;
}

const REAL_WAIT: SeedWait = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * mintApiToken for a caller that may arrive while the server on this root is still
 * starting — above all a controller's `penguin auth token` over ssh, sent the moment that
 * machine's `server status` says "running". Running means the lock is live: the pid is alive
 * and the port accepts. The port binds before the platform boots (so an early client is
 * answered "starting" rather than refused), and the admin is seeded only after it, so for a
 * few seconds on a fresh root there is a live server and no account — or no web.db at all.
 *
 * In exactly that state — a live lock, and no database or no account in it of any kind —
 * this polls until the seed lands and then mints, giving up after SEED_WAIT_MS. Every other
 * outcome is returned at once, in the words mintApiToken uses: no live server means nothing
 * is coming to seed the root, and a database holding accounts but not this one has already
 * been seeded, so waiting would only delay the same answer.
 */
export async function mintApiTokenOnceSeeded(
  root: string,
  opts: MintTokenOptions = {},
  wait: SeedWait = REAL_WAIT,
): Promise<MintTokenResult> {
  const deadline = wait.now() + SEED_WAIT_MS;
  for (;;) {
    const tried = attemptMint(root, opts);
    if (!tried.beforeSeed) return tried.result;
    // Asked again on every round: a server that dies while booting ends the wait there.
    if ((await liveServerLock(root)) === null) return tried.result;
    if (wait.now() >= deadline) return stillStarting(tried.result);
    await wait.sleep(SEED_POLL_MS);
  }
}

/** The outcome when the wait runs out: what is still missing, and that the server owes it. */
function stillStarting(result: MintTokenResult): MintTokenResult {
  const missing = result.outcome === "failed" ? result.detail : "no web.db yet";
  return {
    outcome: "failed",
    detail:
      `the server running on this data root has not finished starting within ` +
      `${SEED_WAIT_MS / 1000}s (${missing})`,
  };
}

/**
 * One mint, and whether its failure is the one a server that has not seeded yet produces: no
 * database, or a database with no account in it at all. Only then is there anything to wait
 * for — a seed creates the admin exactly when the users table is empty (auth/service.ts).
 */
function attemptMint(
  root: string,
  opts: MintTokenOptions,
): { result: MintTokenResult; beforeSeed: boolean } {
  const userId = opts.userId ?? "admin";
  const dbPath = opts.dbPath ?? path.join(root, "web.db");
  // Existence check first: openExistingDatabase would otherwise create an empty file, and a
  // root with no web.db has no account to mint for.
  if (!fs.existsSync(dbPath)) return { result: { outcome: "no_server" }, beforeSeed: true };

  let db: ReturnType<typeof openExistingDatabase> | null = null;
  try {
    db = openExistingDatabase(dbPath);
    const unseeded = holdsNoAccount(db);
    if (unseeded || wire(UsersRepo, { db: db }).findById(userId) === null) {
      return {
        result: { outcome: "failed", detail: `no such account: ${userId}` },
        beforeSeed: unseeded,
      };
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
    return { result: { outcome: "minted", token, userId, expiresAt }, beforeSeed: false };
  } catch (err) {
    return { result: { outcome: "failed", detail: explain(err, dbPath) }, beforeSeed: false };
  } finally {
    db?.close();
  }
}

/**
 * No account at all — including a database whose tables do not exist yet: a server creating
 * web.db makes the file a moment before its schema, and a mint in between would otherwise
 * read "no such table" as a broken database.
 */
function holdsNoAccount(db: DatabaseSync): boolean {
  const table = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'")
    .get();
  return table === undefined || wire(UsersRepo, { db: db }).count() === 0;
}
