/**
 * Auth service: built-in admin seeding /
 * login / logout / password change / session validation.
 *
 * - No open registration: on startup, if there are no users at all, the built-in
 *   admin `admin` is seeded with a random password that is hashed and discarded
 *   unseen (PENGUIN_SEED_ADMIN_PASSWORD injects a fixed one for tests/e2e), and it
 *   adopts `default_project`. The account is claimed through the first-login link;
 *   all other users are created by an admin via the user backend (admin-service).
 * - An initial password (whether seeded or set by an admin) is flagged with
 *   password_is_initial, which the frontend uses to prompt for a password change soon.
 * - Sessions: a token the server SIGNED, carrying its own claims (token-codec.ts). Nothing is
 *   stored for one; valid for 30 days, renewed to the full term whenever one is used a day or
 *   more after issue. Cutting one short before its expiry is a revocation (auth_revocations).
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
 * The password a seeded or reset admin account carries until somebody claims it via the
 * first-login link. Nobody ever reads or types it — it is hashed at once and discarded —
 * which is what lets it be long enough (144 bits) that the login endpoint, where the account
 * is reachable from the moment it exists, has no search space to offer.
 */
export function generateInitialAdminPassword(): string {
  return randomBytes(SEED_PASSWORD_CHARS).toString("base64url").slice(0, SEED_PASSWORD_CHARS);
}

/**
 * How a session was established: "password" via the login form, "desktop" via the desktop
 * shell's one-shot token, "setup" via the first-login link printed for a server whose admin
 * password has never been set.
 *
 * Carried per session because two allowances key off it. Setting a password WITHOUT the old
 * one is open to "desktop" and "setup" — in both, the account's current password is a random
 * value nobody has ever seen, so there is nothing to type into an old-password field. The
 * desktop-only ROUTES remain open to "desktop" alone: "setup" proves someone read this boot's
 * link, not that they own the machine the shell runs on.
 *
 * Anything else — legacy rows (NULL), and the "cli" claim on minted tokens — reads as
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
  /** Revoked-before-expiry token ids; the in-memory copy is what the hot path consults. */
  authRevocations: AuthRevocationsRepo;
  /** Signing key for session tokens — in memory only, fresh per process (token-codec.ts). */
  tokenSecret: Buffer;
  /**
   * This boot's owner token (auth/owner-token.ts), for the redemption endpoint.
   *
   * Held here rather than read back from `<root>/owner-token` when a redemption arrives: the
   * file is how the value is PUBLISHED, not what makes it true. A check against the file would
   * accept whatever it currently holds, which makes being able to WRITE the root enough to
   * mint an admin session — where the axiom is that being able to READ it is ownership. Those
   * are not the same set of people: the file is 0600, but the root's own mode is whatever the
   * umask gave it, so a group-writable root lets someone who cannot read the token replace it.
   *
   * Null where there is no data root to anchor it to (some tests). Redemption then refuses
   * every token rather than falling back to something weaker.
   */
  ownerToken: string | null;
  /** Provisions the initial Project at signup (injected by project-service, to avoid a circular dependency). */
  provisionInitialProject: (user: UserRow, isAdmin: boolean) => Promise<void>;
  /** Fixed initial password for the seeded admin (config.seedAdminPassword); null generates a random one at seed time. */
  seedAdminPassword: string | null;
  sessionTtlMs: number;
  sessionRenewMs: number;
  /**
   * Test double: scrypt work factor for hashes this service writes. Omitted in
   * production, where {@link SCRYPT_COST} applies.
   */
  passwordHashCost?: number;
  now?: () => Date;
}

export class AuthService {
  /**
   * What a fresh user is provisioned with is business policy, answered by the CURRENT
   * App: the platform installs its answer at create over the claimed auth capability
   * (ordinary capability use, not a registry entry), and each swap's successor overwrites
   * it. Starts as the constructor-supplied fallback so standalone/test constructions
   * keep working unchanged.
   */
  private provisioner: (user: UserRow, isAdmin: boolean) => Promise<void>;

  private readonly now: () => Date;
  private readonly hashCost: number;
  /**
   * Revoked token ids with their expiry (epoch ms), mirrored from auth_revocations at
   * construction and kept in step by logout. This is what keeps the per-request path off the
   * database: it only ever holds tokens revoked before their own expiry, so it stays tiny —
   * and entries whose token has since expired are pruned wherever the table itself is swept.
   */
  private readonly revokedJtis: Map<string, number>;
  /**
   * The setup session a first-login link carries; null until mintFirstLogin(). An ordinary
   * session rather than a separate secret, so setting a password kills it through the same
   * denylist every logout uses — including the claimer's own copy, which IS this value.
   */
  private firstLogin: string | null = null;

  /**
   * How long a session this service issues is good for. Exposed because the cookie that
   * carries one has to expire with it, and a second copy of the number written at the cookie's
   * own call site is how the two drift — a cookie that expired first would log someone out
   * while their session was still valid.
   */
  get sessionTtlMs(): number {
    return this.deps.sessionTtlMs;
  }

  constructor(private readonly deps: AuthServiceDeps) {
    this.provisioner = deps.provisionInitialProject;
    this.now = deps.now ?? (() => new Date());
    this.hashCost = deps.passwordHashCost ?? SCRYPT_COST;
    // Boot-time sweep: rows whose token has expired anyway are dead weight — the signature
    // check refuses those tokens on its own — so they are dropped before the mirror is seeded.
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
   * once the server is claimed, so the only setup session that ever exists is a printed one;
   * a claimed server's restart therefore has nothing to revoke. Not mintable from the
   * constructor: seedAdmin() runs after it, so "is this server claimed" has no answer there.
   */
  mintFirstLogin(): string | null {
    if (!this.adminPasswordIsInitial()) return null;
    // A cached link that no longer authenticates (it aged past the session TTL on a server
    // nobody claimed) is re-minted rather than returned: handing out a dead link helps nobody.
    if (this.firstLogin !== null && this.authenticateWithMeta(this.firstLogin) === null) {
      this.firstLogin = null;
    }
    this.firstLogin ??= this.issueSession(ADMIN_USER_ID, "setup");
    return this.firstLogin;
  }

  /**
   * Whether `password` is the admin's current password. Sole consumer: the startup notice's
   * pinned-seed gate (index.ts) — a pinned PENGUIN_SEED_ADMIN_PASSWORD normally means the
   * operator knows the password and needs no first-login link, but an offline reset replaces
   * the password with an unknowable one while the pin is still configured, and the gate must
   * see through that or the rescue flow dead-ends.
   */
  async adminPasswordIs(password: string): Promise<boolean> {
    const row = this.deps.users.findById(ADMIN_USER_ID);
    return row !== null && (await verifyPassword(password, row.passwordHash));
  }

  /**
   * Startup seeding (idempotent): creates the built-in admin and adopts default_project when
   * the users table is empty; if the initial Project fails, the user row is rolled back and
   * the server retries on next startup. The password is hashed and discarded — the account
   * is claimed through the first-login link.
   */
  async seedAdmin(): Promise<void> {
    if (this.deps.users.count() > 0) return;
    const password = this.deps.seedAdminPassword ?? generateInitialAdminPassword();
    // The override (PENGUIN_SEED_ADMIN_PASSWORD) must meet the same policy as every
    // other initial/reset password; rejecting it here, before any insert, keeps a
    // configuration typo from creating a trivially weak privileged account. Generated
    // passwords are 24 characters and never trip this.
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
   * Redeems this boot's first-login token for a setup session.
   *
   * Valid only while the admin password has never been set: the link exists to claim an
   * unclaimed server, and the moment a password is set there is nothing left to claim. Not
   * single-use on purpose — a browser prefetching the link would burn a one-shot token and
   * strand the person holding it, and the window it stays open is precisely the window in
   * which the account protects nothing yet.
   */
  redeemFirstLogin(given: string): string | null {
    // Compared against the printed value rather than merely verified: an endpoint that made a
    // cookie out of ANY valid token would let one person hand another a link that signs them
    // into the sender's account — work done there, including pasted credentials, would land
    // in it. Only the link this server printed is accepted.
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
   * Desktop-mode sign-in: issues an admin session WITHOUT a password check — the caller
   * (the claim route) has already redeemed the shell's one-shot token, which is
   * the credential here. Throws if the admin has not been seeded yet (the claim route runs
   * after startup seeding, so this only trips on a broken deployment).
   */
  loginDesktop(): { user: UserInfo; token: string } {
    const row = this.deps.users.findById(ADMIN_USER_ID);
    if (!row) {
      throw new HttpError(500, "internal", "Built-in admin has not been seeded.");
    }
    return { user: toUserInfo(row), token: this.issueSession(row.userId, "desktop") };
  }

  /** Self password change (user settings): validates the old password, and on success clears the initial-password flag; the current session remains valid. */
  async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
    const row = this.deps.users.findById(userId);
    if (!row || !(await verifyPassword(oldPassword, row.passwordHash))) {
      throw new HttpError(400, "password_mismatch", "Current password is incorrect.");
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new HttpError(400, "invalid_password", "Password must be at least 8 characters.");
    }
    this.deps.users.updatePassword(userId, await hashPassword(newPassword, this.hashCost), false);
    // Any password set on the admin ends a live first-login link, whichever door set it.
    // This branch is reachable when the seed was pinned (PENGUIN_SEED_ADMIN_PASSWORD), the
    // one case where the initial password IS knowable.
    if (userId === ADMIN_USER_ID && this.firstLogin !== null) this.logout(this.firstLogin);
  }

  /**
   * Sets a password with no old-password check — for the two sessions where there is no old
   * password to know: the desktop shell's window, and a first-login link. In both, the
   * account's current password is a random value generated at seed and never shown to
   * anyone. The me route is what gates which sessions may call this.
   */
  async setInitialPassword(userId: string, newPassword: string): Promise<void> {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new HttpError(400, "invalid_password", "Password must be at least 8 characters.");
    }
    this.deps.users.updatePassword(userId, await hashPassword(newPassword, this.hashCost), false);
    // Revoked only AFTER the update succeeds: the link exists to let somebody in while no
    // password does, and a rejected attempt (too short, hash failure) must leave it alive —
    // burning it on a typo would strand the claimer until a restart.
    if (this.firstLogin !== null) this.logout(this.firstLogin);
  }

  /**
   * Revocation is the ONLY per-session write in the signed scheme: the row records the
   * exception (a logout before expiry), never the session. An unverifiable token revokes
   * nothing — its signature already refuses it everywhere.
   */
  logout(token: string): void {
    const claims = verifyToken(token, this.deps.tokenSecret);
    const nowMs = this.now().getTime();
    if (claims === null || claims.exp <= nowMs) return;
    // Renewal keeps the jti and slides the expiry, so the copy being presented here may not
    // be the longest-lived one — a sibling renewed later expires up to a full TTL from now.
    // The revocation must outlive every copy, and now+TTL bounds them all; a token that
    // cannot renew has no siblings, so its own expiry is exact.
    const renewable = claims.exp - claims.iat >= this.deps.sessionRenewMs;
    const holdUntil = renewable ? nowMs + this.deps.sessionTtlMs : claims.exp;
    this.revokedJtis.set(claims.jti, holdUntil);
    this.deps.authRevocations.insert(claims.jti, new Date(holdUntil).toISOString());
  }

  /**
   * Validates the cookie token: signature and expiry on CPU, revocation against the in-memory
   * set, plus one users read (existence and the per-user not-before mark).
   *
   * Sliding renewal changes shape: a signature cannot be extended, so nearing expiry the
   * answer carries a REPLACEMENT token for the middleware to set — same claims, fresh window.
   * Only sessions whose own span is at least the renewal window slide; a short minted token
   * (an hour) must expire at its hour, not stretch to a month by being used.
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
    // Per-user revocation: an admin password reset stamps the mark, and every token issued
    // before it dies here.
    if (user.sessionsNotBefore !== null && claims.iat < Date.parse(user.sessionsNotBefore)) {
      return null;
    }
    const via: SessionVia =
      claims.v === "desktop" ? "desktop" : claims.v === "setup" ? "setup" : "password";
    const renewable = claims.exp - claims.iat >= this.deps.sessionRenewMs;
    if (renewable && claims.exp - now.getTime() < this.deps.sessionRenewMs) {
      // The replacement keeps the jti and iat and moves ONLY the expiry — it is the same
      // session with a longer life, exactly as the row model's in-place update was. A fresh
      // jti here would mint a second identity: revoking one (logout, or the first-login
      // link's death) would leave the other alive, and the per-user not-before mark would
      // date the copy from its renewal instead of its issue.
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
   * Redeems this boot's owner token for a signed session — the ONE bootstrap primitive.
   *
   * Whoever presents the token read `<root>/owner-token`, and reading the data root is what
   * ownership has always meant here: the CLI redeems it for `penguin auth token`, a machine
   * redeems it when this server's controller asks over ssh, and nothing needs a password or
   * a key at rest to exist. The TTL is capped at the ordinary session TTL — the owner can
   * mint again forever, so a longer-lived token would add risk and no capability.
   *
   * One null for both refusals (wrong token / no such user): distinguishing them would let a
   * caller WITHOUT the token enumerate accounts.
   */
  redeemOwnerToken(
    given: string,
    userId: string,
    ttlMs: number,
  ): { token: string; expiresAt: string } | null {
    const expected = this.deps.ownerToken;
    if (expected === null || !ownerTokenMatches(given, expected)) return null;
    if (this.deps.users.findById(userId) === null) return null;
    const bounded = Math.max(1_000, Math.min(ttlMs, this.deps.sessionTtlMs));
    const claims = newClaims(userId, "cli", this.now().getTime(), bounded);
    return {
      token: signToken(claims, this.deps.tokenSecret),
      expiresAt: new Date(claims.exp).toISOString(),
    };
  }
}
