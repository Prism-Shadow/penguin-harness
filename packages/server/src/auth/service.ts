/**
 * Auth service: admin seeding / login / logout / password change / session validation.
 *
 * - No open registration: an empty users table seeds the built-in `admin` with a random
 *   password that is hashed and discarded unseen (PENGUIN_SEED_ADMIN_PASSWORD pins one for
 *   tests/e2e); the account is claimed through the first-login link, and every other user
 *   is created by an admin (admin-service). An initial password — seeded or admin-set — is
 *   flagged password_is_initial, which the frontend turns into a change-it-soon prompt.
 * - Sessions are rows in auth_sessions: the cookie carries a 32-byte random token, the row
 *   stores only its sha256. A session outlives a restart (it is on disk); 30 days, renewed
 *   in place when used with under 29 days left. Logout deletes the row.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { UserInfo } from "../api/types.js";
import { HttpError } from "../http/errors.js";
import type { UserRow, UsersRepo } from "../db/repos/users.js";
import { sessionTokenHash } from "../db/repos/auth-sessions.js";
import type { AuthSessionsRepo } from "../db/repos/auth-sessions.js";
import { SCRYPT_COST, hashPassword, verifyPassword } from "./password.js";

export const MIN_PASSWORD_LENGTH = 8;

/** Built-in admin user_id. */
export const ADMIN_USER_ID = "admin";

/**
 * Login throttling, per userId — what a human-chosen password has to survive (seeded ones are
 * 144 bits). After LOGIN_FREE_ATTEMPTS consecutive failures, the next attempt waits an
 * exponentially growing delay (1s doubling to the 60s cap; attempts inside the window are 429
 * and do not extend it), so attacking any one account settles at a guess per minute while a
 * mistyping user never waits over the cap. Success clears the counter. Counters live in
 * process memory (a restart is slower than the cap) and are kept for nonexistent userIds too,
 * so throttling is not an account-existence oracle. Deliberately NOT covered: a concurrent
 * burst before the first failure lands, and callers spreading guesses across many accounts.
 */
const LOGIN_FREE_ATTEMPTS = 5;
const LOGIN_BACKOFF_START_MS = 1000;
const LOGIN_BACKOFF_CAP_MS = 60_000;
/** Failure entries idle longer than this are swept (bounds the map; far above the cap). */
const LOGIN_FAILURE_IDLE_MS = 15 * 60_000;

/** Characters of base64url in a seeded password — 18 random bytes, 144 bits. */
const SEED_PASSWORD_CHARS = 24;

/**
 * The password a seeded or reset admin carries until claimed via the first-login link.
 * Nobody reads or types it — hashed at once and discarded — which is what lets it be long
 * enough that the login endpoint, reachable from the moment the account exists, has no
 * search space to offer.
 */
export function generateInitialAdminPassword(): string {
  return randomBytes(SEED_PASSWORD_CHARS).toString("base64url").slice(0, SEED_PASSWORD_CHARS);
}

/** Constant-time string equality, so redeemFirstLogin cannot be timed into the printed token. */
function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.byteLength === bb.byteLength && timingSafeEqual(ab, bb);
}

/**
 * How a session was established: the login form, the desktop shell's one-shot token, or the
 * first-login link. Two allowances key off it: "desktop" and "setup" may set a password
 * without the old one (their account's current password is random and was never shown), and
 * desktop-only routes open to "desktop" alone — "setup" proves someone read this boot's
 * link, not that they own the machine. Anything else ("cli" on minted tokens) reads as
 * "password", the least-privileged kind.
 */
export type SessionVia = "password" | "desktop" | "setup";

export function toUserInfo(row: UserRow): UserInfo {
  return {
    userId: row.userId,
    isAdmin: row.isAdmin,
    passwordIsInitial: row.passwordIsInitial,
    createdAt: row.createdAt,
  };
}

export interface AuthServiceDeps {
  users: UsersRepo;
  authSessions: AuthSessionsRepo;
  /** Provisions the initial Project at signup (injected by project-service, to avoid a circular dependency). */
  provisionInitialProject: (user: UserRow, isAdmin: boolean) => Promise<void>;
  /** Fixed initial password for the seeded admin (config.seedAdminPassword); null generates a random one at seed time. */
  seedAdminPassword: string | null;
  sessionTtlMs: number;
  sessionRenewMs: number;
  /** Test double: scrypt work factor for hashes this service writes (SCRYPT_COST in production). */
  passwordHashCost?: number;
  now?: () => Date;
}

export class AuthService {
  /**
   * Provisioning is business policy answered by the CURRENT App: each swap installs its
   * answer over the claimed auth capability, overwriting its predecessor's. Starts as the
   * constructor-supplied fallback so standalone/test constructions work unchanged.
   */
  private provisioner: (user: UserRow, isAdmin: boolean) => Promise<void>;

  private readonly now: () => Date;
  private readonly hashCost: number;
  /**
   * The raw first-login token this boot printed (its row is a `setup` session); null until
   * mintFirstLogin(). Kept so setting a password can delete exactly that session's row.
   */
  private firstLogin: string | null = null;

  /** Session lifetime, for the cookie that must expire WITH the session, not before it. */
  get sessionTtlMs(): number {
    return this.deps.sessionTtlMs;
  }

  constructor(private readonly deps: AuthServiceDeps) {
    this.provisioner = deps.provisionInitialProject;
    this.now = deps.now ?? (() => new Date());
    this.hashCost = deps.passwordHashCost ?? SCRYPT_COST;
    this.deps.authSessions.deleteExpired(this.now().toISOString());
  }

  /**
   * Mints the first-login session on demand — the caller prints its token, nothing else
   * stores it. Null once the server is claimed, so the only setup session that ever exists is
   * a printed one. Not mintable from the constructor: seedAdmin() runs after it, so "is this
   * server claimed" has no answer there. A cached link whose row has expired or been deleted
   * is re-minted, not handed out dead.
   */
  mintFirstLogin(): string | null {
    if (!this.adminPasswordIsInitial()) return null;
    if (this.firstLogin !== null && this.authenticateWithMeta(this.firstLogin) === null) {
      this.firstLogin = null;
    }
    this.firstLogin ??= this.issueSession(ADMIN_USER_ID, "setup");
    return this.firstLogin;
  }

  /**
   * Whether `password` is the admin's current password. Sole consumer: the startup notice's
   * pinned-seed gate (index.ts) — a pin normally means the operator knows the password, but
   * an offline reset makes the pin stale while it is still configured, and the gate must see
   * through that or the rescue flow (the link) stays suppressed.
   */
  async adminPasswordIs(password: string): Promise<boolean> {
    const row = this.deps.users.findById(ADMIN_USER_ID);
    return row !== null && (await verifyPassword(password, row.passwordHash));
  }

  /**
   * Startup seeding (idempotent): creates the built-in admin and adopts default_project when
   * the users table is empty; if the initial Project fails, the user row is rolled back and
   * the server retries on next startup.
   */
  async seedAdmin(): Promise<void> {
    if (this.deps.users.count() > 0) return;
    const password = this.deps.seedAdminPassword ?? generateInitialAdminPassword();
    // A pinned override must meet the same policy as every other password — rejected before
    // any insert, so a configuration typo cannot create a trivially weak privileged account.
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(
        `PENGUIN_SEED_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      );
    }
    const user: UserRow = {
      userId: ADMIN_USER_ID,
      passwordHash: await hashPassword(password, this.hashCost),
      isAdmin: true,
      passwordIsInitial: true,
      createdAt: this.now().toISOString(),
    };
    this.deps.users.insert(user);
    try {
      await this.provisioner(user, true);
    } catch (err) {
      this.deps.users.delete(user.userId);
      throw err;
    }
  }

  /** Installs the current App's provisioning policy (see the `provisioner` field). */
  setProvisioner(provision: (user: UserRow, isAdmin: boolean) => Promise<void>): void {
    this.provisioner = provision;
  }

  /**
   * Redeems this boot's first-login token for a setup session. Compared against the printed
   * value rather than merely verified: an endpoint that made a cookie out of ANY valid token
   * would let one person hand another a link that signs them into the sender's account. Not
   * single-use on purpose — a prefetching browser would burn a one-shot token and strand the
   * person holding it, and the window it stays open is exactly the window in which the
   * account protects nothing yet.
   */
  redeemFirstLogin(given: string): string | null {
    const expected = this.firstLogin;
    if (expected === null || given === "" || !constantTimeEqual(given, expected)) return null;
    return this.authenticateWithMeta(expected) === null ? null : expected;
  }

  /** Whether the built-in admin still runs on its initial password (gates the first-login link). */
  adminPasswordIsInitial(): boolean {
    return this.deps.users.findById(ADMIN_USER_ID)?.passwordIsInitial === true;
  }

  /** Consecutive login failures per userId (see the throttling comment on the constants). */
  private readonly loginFailures = new Map<string, { failures: number; lastFailureAt: number }>();

  /** The wait imposed after `failures` consecutive failures (0 while within the free attempts). */
  private loginDelayMs(failures: number): number {
    const excess = failures - LOGIN_FREE_ATTEMPTS;
    if (excess <= 0) return 0;
    return Math.min(LOGIN_BACKOFF_START_MS * 2 ** (excess - 1), LOGIN_BACKOFF_CAP_MS);
  }

  async login(userId: string, password: string): Promise<{ user: UserInfo; token: string }> {
    const nowMs = this.now().getTime();
    for (const [key, entry] of this.loginFailures) {
      if (nowMs - entry.lastFailureAt > LOGIN_FAILURE_IDLE_MS) this.loginFailures.delete(key);
    }
    const failed = this.loginFailures.get(userId);
    if (failed) {
      const readyAt = failed.lastFailureAt + this.loginDelayMs(failed.failures);
      if (nowMs < readyAt) {
        throw new HttpError(
          429,
          "too_many_attempts",
          `Too many failed sign-in attempts. Try again in ${Math.ceil((readyAt - nowMs) / 1000)}s.`,
        );
      }
    }
    const row = this.deps.users.findById(userId);
    const ok = row !== null && (await verifyPassword(password, row.passwordHash));
    if (!row || !ok) {
      this.loginFailures.set(userId, {
        failures: (failed?.failures ?? 0) + 1,
        lastFailureAt: this.now().getTime(),
      });
      throw new HttpError(401, "invalid_credentials", "Incorrect username or password.");
    }
    this.loginFailures.delete(userId);
    this.deps.authSessions.deleteExpired(this.now().toISOString());
    return { user: toUserInfo(row), token: this.issueSession(row.userId, "password") };
  }

  /**
   * Desktop-mode sign-in: an admin session with no password check — the claim route already
   * redeemed the shell's one-shot token, which is the credential here. Throws only on a
   * broken deployment (seeding runs before the route exists).
   */
  loginDesktop(): { user: UserInfo; token: string } {
    const row = this.deps.users.findById(ADMIN_USER_ID);
    if (!row) {
      throw new HttpError(500, "internal", "Built-in admin has not been seeded.");
    }
    return { user: toUserInfo(row), token: this.issueSession(row.userId, "desktop") };
  }

  /** Self password change (user settings): validates the old password first; the current session stays valid. */
  async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
    const row = this.deps.users.findById(userId);
    if (!row || !(await verifyPassword(oldPassword, row.passwordHash))) {
      throw new HttpError(400, "password_mismatch", "Current password is incorrect.");
    }
    await this.setPassword(userId, newPassword);
  }

  /**
   * Sets a password with no old-password check — for the two session kinds whose account's
   * current password is random and was never shown ("desktop"/"setup"; the me route gates
   * which sessions may call this).
   */
  async setInitialPassword(userId: string, newPassword: string): Promise<void> {
    await this.setPassword(userId, newPassword);
  }

  /**
   * The shared tail of every password set: policy check, hash, store, and — for the admin —
   * the deletion of any live first-login session. Validation comes FIRST, so a rejected
   * attempt (too short) leaves the link alive: burning it on a typo would strand the claimer
   * until a restart.
   */
  private async setPassword(userId: string, newPassword: string): Promise<void> {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new HttpError(400, "invalid_password", "Password must be at least 8 characters.");
    }
    this.deps.users.updatePassword(userId, await hashPassword(newPassword, this.hashCost), false);
    // EVERY first-login session for this account, not just the link this process printed: an
    // earlier boot's link can still be live in a terminal scrollback, and a `setup` session is
    // allowed to change the password without knowing the old one — so one left behind is an
    // account takeover waiting to happen.
    if (userId === ADMIN_USER_ID) {
      this.deps.authSessions.deleteByUserAndVia(userId, "setup");
      this.firstLogin = null;
    }
  }

  /** Ends a session: the row is the session, so logout deletes it. Unknown token is a no-op. */
  logout(token: string): void {
    this.deps.authSessions.delete(sessionTokenHash(token));
  }

  /**
   * Validates the cookie token: one indexed read of auth_sessions, plus the user row. An
   * expired row is deleted and refused. Sliding renewal tops the expiry up IN PLACE (the
   * cookie value never changes, so there is no second identity to revoke); only a session
   * whose own span is at least the renewal window slides, so a short minted token (an hour)
   * expires at its hour rather than stretching to a month by being used. `renewed` tells the
   * middleware to refresh the cookie's own max-age to match.
   */
  authenticateWithMeta(token: string): { user: UserRow; via: SessionVia; renewed: boolean } | null {
    const tokenHash = sessionTokenHash(token);
    const session = this.deps.authSessions.findByTokenHash(tokenHash);
    if (!session) return null;
    const now = this.now();
    const expiresAt = Date.parse(session.expiresAt);
    if (expiresAt <= now.getTime()) {
      this.deps.authSessions.delete(tokenHash);
      return null;
    }
    const user = this.deps.users.findById(session.userId);
    if (!user) return null;
    const renewable = expiresAt - Date.parse(session.createdAt) >= this.deps.sessionRenewMs;
    let renewed = false;
    if (renewable && expiresAt - now.getTime() < this.deps.sessionRenewMs) {
      this.deps.authSessions.touch(
        tokenHash,
        new Date(now.getTime() + this.deps.sessionTtlMs).toISOString(),
      );
      renewed = true;
    }
    const via: SessionVia =
      session.via === "desktop" ? "desktop" : session.via === "setup" ? "setup" : "password";
    return { user, via, renewed };
  }

  private issueSession(userId: string, via: SessionVia): string {
    return this.deps.authSessions.issue({
      userId,
      via,
      now: this.now(),
      ttlMs: this.deps.sessionTtlMs,
    }).token;
  }
}
