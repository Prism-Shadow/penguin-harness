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
 * That is why it is strictly better than the password path it replaces. A password read off
 * disk is long-lived, unrevocable and the same secret everywhere it is used; a token here
 * expires in an hour and can be deleted from one table. And the credential that must NOT move
 * — the admin password — stays where it is, which was the point of the original design.
 *
 * The row records `via: "cli"`. Nothing grants privilege from it — the middleware reads
 * anything that is not "desktop" as an ordinary password session, so a token minted here can
 * never reach the desktop-only routes — but the table tells the truth about where it came
 * from, which is what an audit of "who has a session" needs to be able to say.
 */
import { createHash, randomBytes } from "node:crypto";
import { openDatabase } from "./db/database.js";
import { AuthSessionsRepo } from "./db/repos/auth-sessions.js";
import { UsersRepo } from "./db/repos/users.js";

/** An hour, matching what a controller needs: long enough to finish, short enough to forget. */
export const CLI_TOKEN_TTL_MS = 60 * 60_000;

export type MintTokenResult =
  | { outcome: "minted"; token: string; userId: string; expiresAt: string }
  | { outcome: "no_database"; dbPath: string }
  | { outcome: "no_user"; userId: string };

const sha256Hex = (value: string): string => createHash("sha256").update(value).digest("hex");

/**
 * Issues an API session token against the database at `dbPath`.
 *
 * Deliberately does NOT refuse while a server is running, unlike the offline password reset:
 * a token is only useful precisely because a server is up to accept it. The write is a single
 * INSERT into a WAL database, which is what makes writing beside a live server safe here and
 * not there — and the server reads sessions from the table on every request, so the token
 * works the moment this returns, with nothing to restart or invalidate.
 */
export function mintApiToken(
  dbPath: string,
  opts: { userId?: string; ttlMs?: number; now?: () => Date } = {},
): MintTokenResult {
  const now = opts.now?.() ?? new Date();
  let db;
  try {
    db = openDatabase(dbPath);
  } catch {
    return { outcome: "no_database", dbPath };
  }
  try {
    const users = new UsersRepo(db);
    // Defaults to the built-in admin: this is the account a controller acts as, and on a
    // machine whose data root the caller can already read it is not an escalation to name it.
    const wanted = opts.userId ?? "admin";
    const user = users.findById(wanted);
    if (user === null) return { outcome: "no_user", userId: wanted };

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now.getTime() + (opts.ttlMs ?? CLI_TOKEN_TTL_MS)).toISOString();
    new AuthSessionsRepo(db).insert({
      tokenHash: sha256Hex(token),
      userId: user.userId,
      createdAt: now.toISOString(),
      expiresAt,
      via: "cli",
    });
    return { outcome: "minted", token, userId: user.userId, expiresAt };
  } finally {
    db.close();
  }
}
