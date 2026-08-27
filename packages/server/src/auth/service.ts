/**
 * Auth service: admin seeding / login / logout / password change / session validation.
 *
 * No open registration: an empty users table seeds `admin` with a random password hashed and
 * discarded unseen, claimed through the first-login link; every other user is created by an
 * admin. Sessions are rows in auth_sessions (cookie holds the token, the row its sha256), so
 * they outlive a restart and renew in place.
 */
import { randomBytes } from "node:crypto";
import { tokensEqual } from "./api-token.js";
import type { UserInfo } from "../api/types.js";
import { HttpError } from "../http/errors.js";
import type { UserRow, UsersRepo } from "../db/repos/users.js";
import { sessionTokenHash } from "../db/repos/auth-sessions.js";
import type { SessionViaValue } from "../db/repos/auth-sessions.js";
import type { AuthRuntimeState } from "./runtime-state.js";
import type { AuthSessionsRepo } from "../db/repos/auth-sessions.js";
import { SCRYPT_COST, hashPassword, verifyPassword } from "./password.js";

export const MIN_PASSWORD_LENGTH = 8;

/** Built-in admin user_id. */
export const ADMIN_USER_ID = "admin";

/**
 * Login throttling, per userId. After LOGIN_FREE_ATTEMPTS failures each attempt waits an
 * exponentially growing delay (1s doubling to a 60s cap), settling at a guess per minute.
 * Kept for nonexistent userIds too, so it is not an account-existence oracle. Deliberately NOT
 * covered: a concurrent burst before the first failure lands, and guesses spread across many
 * accounts.
 */
const LOGIN_FREE_ATTEMPTS = 5;
const LOGIN_BACKOFF_START_MS = 1000;
const LOGIN_BACKOFF_CAP_MS = 60_000;
/** Failure entries idle longer than this are swept (bounds the map; far above the cap). */
const LOGIN_FAILURE_IDLE_MS = 15 * 60_000;

/** Characters of base64url in a seeded password — 18 random bytes, 144 bits. */
const SEED_PASSWORD_CHARS = 24;

/**
 * Never read or typed — hashed at once and discarded — which is what lets it be long enough
 * that the login endpoint, reachable the moment the account exists, has no search space.
 */
export function generateInitialAdminPassword(): string {
  return randomBytes(SEED_PASSWORD_CHARS).toString("base64url").slice(0, SEED_PASSWORD_CHARS);
}

/**
 * "desktop" and "setup" may set a password without the old one (theirs is random and was never
 * shown); desktop-only routes open to "desktop" alone. "token" is the local API token's Bearer
 * header — per request, never a stored row. Anything else reads as "password".
 */
export type SessionVia = "password" | "desktop" | "setup" | "token";

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
  /**
   * Process-scoped auth values (runtime-state.ts). Held by the RUNTIME so the link a boot
   * printed survives a platform push; everything else about auth is rebuilt with the App.
   */
  state: AuthRuntimeState;
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
  private readonly now: () => Date;
  private readonly hashCost: number;
  /** Session lifetime, for the cookie that must expire WITH the session, not before it. */
  get sessionTtlMs(): number {
    return this.deps.sessionTtlMs;
  }

  constructor(private readonly deps: AuthServiceDeps) {
    this.now = deps.now ?? (() => new Date());
    this.hashCost = deps.passwordHashCost ?? SCRYPT_COST;
    this.deps.authSessions.deleteExpired(this.now().toISOString());
  }

  /**
   * Null once the server is claimed, so the only setup session that exists is a printed one.
   * On demand rather than in the constructor: seedAdmin() runs after it, so "claimed?" has no
   * answer there. A cached link whose row is gone is re-minted, not handed out dead.
   */
  mintFirstLogin(): string | null {
    if (!this.adminPasswordIsInitial()) return null;
    if (
      this.deps.state.firstLoginToken !== null &&
      this.authenticateWithMeta(this.deps.state.firstLoginToken) === null
    ) {
      this.deps.state.firstLoginToken = null;
    }
    this.deps.state.firstLoginToken ??= this.issueSession(ADMIN_USER_ID, "setup");
    return this.deps.state.firstLoginToken;
  }

  /**
   * For the startup notice's pinned-seed gate (index.ts): a pin usually means the operator
   * knows the password, but an offline reset makes it stale, and the gate must see through
   * that or the rescue link stays suppressed.
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
      await this.deps.provisionInitialProject(user, true);
    } catch (err) {
      this.deps.users.delete(user.userId);
      throw err;
    }
  }

  /**
   * Compared against the printed value, not merely verified: a cookie made out of ANY valid
   * token would let one person hand another a link into the sender's account. Not single-use,
   * because a prefetching browser would burn it before its reader clicked.
   */
  redeemFirstLogin(given: string): string | null {
    const expected = this.deps.state.firstLoginToken;
    if (expected === null || given === "" || !tokensEqual(given, expected)) return null;
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

  /** No old-password check; the me route gates which sessions may call this. */
  async setInitialPassword(userId: string, newPassword: string): Promise<void> {
    await this.setPassword(userId, newPassword);
  }

  /**
   * Validation comes FIRST, so a rejected password leaves the first-login link alive: burning
   * it on a typo would strand the claimer until a restart.
   */
  private async setPassword(userId: string, newPassword: string): Promise<void> {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new HttpError(400, "invalid_password", "Password must be at least 8 characters.");
    }
    this.deps.users.updatePassword(userId, await hashPassword(newPassword, this.hashCost), false);
    // A successful set proves at least what the successful login that resets the counter
    // proves (the old password, or a desktop/setup session), so it resets it too. Without
    // this, anyone spamming the login endpoint holds the backoff window open, and the sign-in
    // that follows a first-login claim (routes/me.ts) would 429 AFTER the password committed —
    // reporting failure for a change that took, with the claimer's setup session already gone.
    this.loginFailures.delete(userId);
    // EVERY first-login session for this account, not just the link this process printed: an
    // earlier boot's link can still be live in a terminal scrollback, and a `setup` session is
    // allowed to change the password without knowing the old one — so one left behind is an
    // account takeover waiting to happen.
    if (userId === ADMIN_USER_ID) {
      this.deps.authSessions.deleteByUserAndVia(userId, "setup");
      this.deps.state.firstLoginToken = null;
    }
  }

  /** Ends a session: the row is the session, so logout deletes it. Unknown token is a no-op. */
  logout(token: string): void {
    this.deps.authSessions.delete(sessionTokenHash(token));
  }

  /**
   * The current boot's local API token (what control-env injection hands to tool
   * subprocesses); null when none was minted. It lives on the runtime state, not on this
   * service: the token was written to `<root>/api-token` by the process, so it must
   * outlive the App a push replaces (auth/runtime-state.ts).
   */
  localApiToken(): string | null {
    return this.deps.state.apiToken;
  }

  /**
   * Validates a Bearer token against the boot's local API token (constant-time compare):
   * a match authenticates as the built-in admin — holding the token proves filesystem
   * access to the data root, which is admin authority (see auth/api-token.ts). Returns
   * null on mismatch, when no token was minted, or when the admin row is missing.
   */
  authenticateApiToken(token: string): { user: UserRow; via: SessionVia } | null {
    const apiToken = this.deps.state.apiToken;
    if (apiToken === null || token.length === 0) return null;
    if (!tokensEqual(token, apiToken)) return null;
    const user = this.deps.users.findById(ADMIN_USER_ID);
    return user === null ? null : { user, via: "token" };
  }

  /**
   * Validates the cookie token. Sliding renewal tops the expiry up IN PLACE, so the cookie
   * value never changes and there is no second identity to revoke. Only a session whose own
   * span reaches the renewal window slides — a one-hour minted token must expire at its hour,
   * not stretch by being used.
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

  private issueSession(userId: string, via: SessionViaValue): string {
    return this.deps.authSessions.issue({
      userId,
      via,
      now: this.now(),
      ttlMs: this.deps.sessionTtlMs,
    }).token;
  }
}
