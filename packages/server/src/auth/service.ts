/**
 * Auth service: admin seeding / login / logout / password change / session validation.
 *
 * - No open registration: an empty users table seeds the built-in `admin` with a random
 *   password that is hashed and discarded unseen (PENGUIN_SEED_ADMIN_PASSWORD pins one for
 *   tests/e2e); the account is claimed through the first-login link, and every other user
 *   is created by an admin (admin-service). An initial password — seeded or admin-set — is
 *   flagged password_is_initial, which the frontend turns into a change-it-soon prompt.
 * - Sessions are signed tokens (token-codec.ts): nothing is stored for one; 30 days, renewed
 *   to the full term when used a day or more after issue. Ending one early is a revocation.
 */
import { randomBytes } from "node:crypto";
import type { UserInfo } from "../api/types.js";
import { HttpError } from "../http/errors.js";
import type { UserRow, UsersRepo } from "../db/repos/users.js";
import type { AuthRevocationsRepo } from "../db/repos/auth-revocations.js";
import { newClaims, signToken, verifyToken } from "./token-codec.js";
import { ownerTokenMatches } from "./owner-token.js";
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
  /** Revoked-before-expiry token ids; the in-memory mirror is what the hot path consults. */
  authRevocations: AuthRevocationsRepo;
  /** Signing key for session tokens — in memory only, fresh per process (token-codec.ts). */
  tokenSecret: Buffer;
  /**
   * This boot's owner token (auth/owner-token.ts), held in memory rather than read back from
   * the file at redemption time: the file is how the value is PUBLISHED, not what makes it
   * true. Checking the file would accept whatever it currently holds — letting anyone who can
   * WRITE the root (whose mode is the umask's) mint an admin session, where the axiom is that
   * READING it is ownership. Null with no data root (some tests): redemption refuses all.
   */
  ownerToken: string | null;
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
   * jti -> expiry (epoch ms), mirroring auth_revocations so the per-request path never reads
   * the database. Only ever holds tokens revoked before their own expiry, so it stays tiny;
   * pruned wherever the table itself is swept.
   */
  private readonly revokedJtis: Map<string, number>;
  /**
   * The setup session a first-login link carries; null until mintFirstLogin(). An ordinary
   * session rather than a separate secret, so setting a password kills it through the same
   * denylist every logout uses — including the claimer's own copy, which IS this value.
   */
  private firstLogin: string | null = null;

  /** Session lifetime, for the cookie that must expire WITH the token, not before it. */
  get sessionTtlMs(): number {
    return this.deps.sessionTtlMs;
  }

  constructor(private readonly deps: AuthServiceDeps) {
    this.provisioner = deps.provisionInitialProject;
    this.now = deps.now ?? (() => new Date());
    this.hashCost = deps.passwordHashCost ?? SCRYPT_COST;
    // Rows whose token has expired are dead weight — the signature check refuses those
    // tokens on its own — so they are dropped before the mirror is seeded.
    this.deps.authRevocations.deleteExpired(this.now().toISOString());
    this.revokedJtis = new Map(
      this.deps.authRevocations.list().map((r) => [r.jti, Date.parse(r.expiresAt)]),
    );
  }

  /** Sweeps expired revocations from the table AND the in-memory mirror, in one place. */
  private sweepRevocations(): void {
    const nowMs = this.now().getTime();
    this.deps.authRevocations.deleteExpired(new Date(nowMs).toISOString());
    for (const [jti, expMs] of this.revokedJtis) {
      if (expMs <= nowMs) this.revokedJtis.delete(jti);
    }
  }

  /**
   * Mints the first-login session on demand — the caller prints it, nothing stores it. Null
   * once the server is claimed, so the only setup session that ever exists is a printed one
   * and a claimed server's restart has nothing to revoke. Not mintable from the constructor:
   * seedAdmin() runs after it, so "is this server claimed" has no answer there. A cached
   * link that aged past the session TTL unclaimed is re-rolled, not handed out dead.
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
      sessionsNotBefore: null,
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
    if (expected === null || given === "" || !ownerTokenMatches(given, expected)) return null;
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
    this.sweepRevocations();
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
   * the end of any live first-login link, whichever door set the password. Validation comes
   * FIRST, so a rejected attempt (too short) leaves the link alive: burning it on a typo
   * would strand the claimer until a restart.
   */
  private async setPassword(userId: string, newPassword: string): Promise<void> {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new HttpError(400, "invalid_password", "Password must be at least 8 characters.");
    }
    this.deps.users.updatePassword(userId, await hashPassword(newPassword, this.hashCost), false);
    if (userId === ADMIN_USER_ID) this.revokeFirstLogin();
  }

  /**
   * Ends every copy of this boot's first-login session — by jti, not by presenting the token:
   * the printed original may have expired while a RENEWED copy of the same jti is live (the
   * setup session renews a day into its life), and a logout of the expired original would
   * early-out and spare the copy. now+TTL bounds every renewable sibling.
   */
  private revokeFirstLogin(): void {
    if (this.firstLogin === null) return;
    const claims = verifyToken(this.firstLogin, this.deps.tokenSecret);
    if (claims !== null) this.revokeJti(claims.jti, this.now().getTime() + this.deps.sessionTtlMs);
  }

  /**
   * Revocation is the ONLY per-session write in the signed scheme: the row records the
   * exception (a logout before expiry), never the session. An unverifiable or expired token
   * revokes nothing — its signature already refuses it everywhere.
   */
  logout(token: string): void {
    const claims = verifyToken(token, this.deps.tokenSecret);
    const nowMs = this.now().getTime();
    if (claims === null || claims.exp <= nowMs) return;
    // Renewal keeps the jti and slides the expiry, so the presented copy may not be the
    // longest-lived sibling; now+TTL bounds them all. A non-renewable token has no siblings.
    const renewable = claims.exp - claims.iat >= this.deps.sessionRenewMs;
    this.revokeJti(claims.jti, renewable ? nowMs + this.deps.sessionTtlMs : claims.exp);
  }

  /** Marks a jti revoked until `holdUntilMs`, in the mirror and the table. */
  private revokeJti(jti: string, holdUntilMs: number): void {
    this.revokedJtis.set(jti, holdUntilMs);
    this.deps.authRevocations.insert(jti, new Date(holdUntilMs).toISOString());
  }

  /**
   * Validates the cookie token: signature and expiry on CPU, revocation against the mirror,
   * one users read (existence + the per-user not-before mark). Nearing expiry, a renewable
   * session rides out with a REPLACEMENT token that keeps jti and iat and moves ONLY the
   * expiry — the same session with a longer life, as the row model's in-place update was. A
   * fresh jti would be a second identity that no revocation path sees. Short minted tokens
   * (an hour) never renew: their hour must not stretch by mere use.
   */
  authenticateWithMeta(
    token: string,
  ): { user: UserRow; via: SessionVia; renewedToken?: string } | null {
    const now = this.now();
    const claims = verifyToken(token, this.deps.tokenSecret);
    if (claims === null) return null;
    if (claims.exp <= now.getTime()) return null;
    if (this.revokedJtis.has(claims.jti)) return null;
    const user = this.deps.users.findById(claims.u);
    if (!user) return null;
    if (user.sessionsNotBefore !== null && claims.iat < Date.parse(user.sessionsNotBefore)) {
      return null;
    }
    const via: SessionVia =
      claims.v === "desktop" ? "desktop" : claims.v === "setup" ? "setup" : "password";
    const renewable = claims.exp - claims.iat >= this.deps.sessionRenewMs;
    if (renewable && claims.exp - now.getTime() < this.deps.sessionRenewMs) {
      return {
        user,
        via,
        renewedToken: signToken(
          { ...claims, exp: now.getTime() + this.deps.sessionTtlMs },
          this.deps.tokenSecret,
        ),
      };
    }
    return { user, via };
  }

  private issueSession(userId: string, via: SessionVia): string {
    const claims = newClaims(userId, via, this.now().getTime(), this.deps.sessionTtlMs);
    return signToken(claims, this.deps.tokenSecret);
  }

  /**
   * Redeems this boot's owner token for a signed session — the one bootstrap primitive.
   * Whoever presents it read `<root>/owner-token`, and reading the data root is what
   * ownership means here. TTL capped at the session TTL: the owner can mint again forever,
   * so longer would add risk and no capability. One null for both refusals (wrong token /
   * no such user), or a caller without the token could enumerate accounts.
   */
  redeemOwnerToken(
    given: string,
    userId: string,
    ttlMs: number,
  ): { token: string; expiresAt: string } | null {
    const expected = this.deps.ownerToken;
    if (expected === null || !ownerTokenMatches(given, expected)) return null;
    if (this.deps.users.findById(userId) === null) return null;
    // The other frequent path (beside login) that should shrink the revocation mirror.
    this.sweepRevocations();
    const bounded = Math.max(1_000, Math.min(ttlMs, this.deps.sessionTtlMs));
    const claims = newClaims(userId, "cli", this.now().getTime(), bounded);
    return {
      token: signToken(claims, this.deps.tokenSecret),
      expiresAt: new Date(claims.exp).toISOString(),
    };
  }
}
