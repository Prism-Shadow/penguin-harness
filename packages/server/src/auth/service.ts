/**
 * Auth service: built-in admin seeding /
 * login / logout / password change / session validation.
 *
 * - No open registration: on startup, if there are no users at all, the built-in
 *   admin `admin` is seeded with a random `penguin-<4 digits>` initial password
 *   (printed once by the startup entrypoint; PENGUIN_SEED_ADMIN_PASSWORD injects
 *   a fixed one for tests/e2e), and it adopts `default_project`; all other users
 *   are created by an admin via the user backend (admin-service).
 * - An initial password (whether seeded or set by an admin) is flagged with
 *   password_is_initial, which the frontend uses to prompt for a password change soon.
 * - Sessions: a 32-byte random token, with only its sha256 hash stored in the DB;
 *   valid for 7 days, with sliding renewal once less than 6 days remain.
 */
import { createHash, randomBytes, randomInt } from "node:crypto";
import type { UserInfo } from "../api/types.js";
import { HttpError } from "../http/errors.js";
import type { AuthSessionsRepo } from "../db/repos/auth-sessions.js";
import type { UserRow, UsersRepo } from "../db/repos/users.js";
import type { AuthRevocationsRepo } from "../db/repos/auth-revocations.js";
import { looksSigned, newClaims, signToken, verifyToken } from "./token-codec.js";
import { ownerTokenMatches } from "./owner-token.js";
import { SCRYPT_COST, hashPassword, verifyPassword } from "./password.js";

export const MIN_PASSWORD_LENGTH = 8;

/** Built-in admin user_id. */
export const ADMIN_USER_ID = "admin";

/**
 * Login throttling (per userId): the seeded initial password is `penguin-<4 digits>` —
 * 10,000 combinations — so unthrottled guessing would enumerate it in minutes. After
 * LOGIN_FREE_ATTEMPTS consecutive failures, the next attempt is admitted only after an
 * exponentially growing delay from the last failure (1s, 2s, … capped at 60s; attempts
 * inside the window are 429 `too_many_attempts` and do not extend it). Beyond ~40
 * failures that is one guess per minute, so the 10k space stops being enumerable, while
 * a legitimate user who mistyped a few times never waits more than the cap. A successful
 * login clears the counter. Counters are process memory (a restart clears them —
 * restarting is slower than waiting out the cap) and are kept for nonexistent userIds
 * too, so throttling is not an account-existence oracle. Known limit: a concurrent burst
 * can slip in before its first failure is recorded; the steady-state backoff still
 * dominates the search space.
 */
const LOGIN_FREE_ATTEMPTS = 5;
const LOGIN_BACKOFF_START_MS = 1000;
const LOGIN_BACKOFF_CAP_MS = 60_000;
/** Failure entries idle longer than this are swept (bounds the map; far above the cap). */
const LOGIN_FAILURE_IDLE_MS = 15 * 60_000;

/**
 * Random initial password for the seeded admin: `penguin-<4 digits>` — brand-related and
 * easy to type, shown once in the server startup output (the README, docs and login-page
 * hint all describe this form).
 */
export function generateInitialAdminPassword(): string {
  return "penguin-" + String(randomInt(0, 10000)).padStart(4, "0");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
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
  authSessions: AuthSessionsRepo;
  /** Revoked-before-expiry token ids; the in-memory copy is what the hot path consults. */
  authRevocations: AuthRevocationsRepo;
  /**
   * Signing key for session tokens. IN MEMORY ONLY, generated at process start: a key that
   * exists nowhere at rest cannot be taken from a backup, and rotation is simply a restart.
   * The price is that signed sessions die with the process — hot pushes swap the App and
   * keep this alive; only a real restart pays it, and mostly in re-typed passwords.
   */
  tokenSecret: Buffer;
  /**
   * This boot's owner token (auth/owner-token.ts), for the redemption endpoint. Null in
   * constructions that have no data root to anchor it to (some tests).
   */
  ownerToken: string | null;
  /**
   * This boot's first-login token — the value in the link a fresh server prints. Held only
   * here, never written down: a link from a previous run is already dead, and one from this
   * run dies the moment a password is set.
   */
  firstLoginToken: string;
  /** Provisions the initial Project at signup (injected by project-service, to avoid a circular dependency). */
  provisionInitialProject: (user: UserRow, isAdmin: boolean) => Promise<void>;
  /** Fixed initial password for the seeded admin (config.seedAdminPassword); null generates a random one at seed time. */
  seedAdminPassword: string | null;
  /**
   * Fired after any successful password update (self change / desktop set). The server
   * wires it to drop the stored initial-password plaintext once it goes stale (see
   * initial-password.ts); standalone/test constructions may omit it.
   */
  onPasswordChanged?: (userId: string) => void;
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
   * Revoked token ids, mirrored from auth_revocations at construction and kept in step by
   * logout. This is what keeps the per-request path off the database: the set only ever
   * holds tokens revoked before their own expiry, so it stays tiny by construction.
   */
  private readonly revokedJtis: Set<string>;

  constructor(private readonly deps: AuthServiceDeps) {
    this.provisioner = deps.provisionInitialProject;
    this.now = deps.now ?? (() => new Date());
    this.hashCost = deps.passwordHashCost ?? SCRYPT_COST;
    // Boot-time sweep: rows whose token has expired anyway are dead weight — the signature
    // check refuses those tokens on its own — so they are dropped before the set is seeded.
    this.deps.authRevocations.deleteExpired(this.now().toISOString());
    this.revokedJtis = new Set(this.deps.authRevocations.listJtis());
  }

  /**
   * Startup seeding (idempotent): creates the built-in admin and adopts
   * default_project when the users table is empty; if the initial Project fails,
   * the user row is rolled back and the server retries on next startup.
   * Returns the initial password when it actually seeded — the caller prints it,
   * the only place a generated password is ever shown — and null when users
   * already exist.
   */
  async seedAdmin(): Promise<string | null> {
    if (this.deps.users.count() > 0) return null;
    const password = this.deps.seedAdminPassword ?? generateInitialAdminPassword();
    // The override (PENGUIN_SEED_ADMIN_PASSWORD) must meet the same policy as every
    // other initial/reset password; rejecting it here, before any insert, keeps a
    // configuration typo from creating a trivially weak privileged account. Generated
    // passwords are always 12 characters and never trip this.
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
    return password;
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
  redeemFirstLogin(token: string): { token: string } | null {
    if (token === "" || !ownerTokenMatches(token, this.deps.firstLoginToken)) return null;
    if (!this.adminPasswordIsInitial()) return null;
    return { token: this.issueSession(ADMIN_USER_ID, "setup") };
  }

  /** Whether the built-in admin still runs on its initial password (drives the startup reminder notice). */
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
    this.deps.authRevocations.deleteExpired(this.now().toISOString());
    this.deps.authSessions.deleteExpired(this.now().toISOString());
    return { user: toUserInfo(row), token: this.issueSession(row.userId, "password") };
  }

  /**
   * Desktop-mode sign-in: issues an admin session WITHOUT a password check — the caller
   * (the desktop-login route) has already redeemed the shell's one-shot token, which is
   * the credential here. Throws if the admin has not been seeded yet (desktop-login runs
   * after startup seeding, so this only trips on a broken deployment).
   */
  loginDesktop(): { user: UserInfo; token: string } {
    const row = this.deps.users.findById(ADMIN_USER_ID);
    if (!row) {
      throw new HttpError(500, "internal", "Built-in admin has not been seeded.");
    }
    this.deps.authSessions.deleteExpired(this.now().toISOString());
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
    this.deps.onPasswordChanged?.(userId);
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
    this.deps.onPasswordChanged?.(userId);
  }

  /**
   * Revocation is the ONLY per-session write in the signed scheme: the row records the
   * exception (a logout before expiry), never the session. An unverifiable token revokes
   * nothing — its signature already refuses it everywhere.
   */
  logout(token: string): void {
    if (looksSigned(token)) {
      const claims = verifyToken(token, this.deps.tokenSecret);
      if (claims === null || claims.exp <= this.now().getTime()) return;
      this.revokedJtis.add(claims.jti);
      this.deps.authRevocations.insert(claims.jti, new Date(claims.exp).toISOString());
      return;
    }
    this.deps.authSessions.delete(sha256Hex(token));
  }

  /**
   * Validates the cookie token. Signed tokens verify on CPU alone plus one users read — the
   * hot path this scheme exists for; the row lookup remains only for sessions issued before
   * the switch, which age out within one TTL and are never issued again.
   *
   * Sliding renewal changes shape: a signature cannot be extended, so nearing expiry the
   * answer carries a REPLACEMENT token for the middleware to set — same claims, fresh
   * window. Only sessions whose own span is at least the renewal window slide; a short
   * minted token (an hour) must expire at its hour, not stretch to a week by being used.
   */
  authenticateWithMeta(
    token: string,
  ): { user: UserRow; via: SessionVia; renewedToken?: string } | null {
    const now = this.now();
    if (looksSigned(token)) {
      const claims = verifyToken(token, this.deps.tokenSecret);
      if (claims === null) return null;
      if (claims.exp <= now.getTime()) return null;
      if (this.revokedJtis.has(claims.jti)) return null;
      const user = this.deps.users.findById(claims.u);
      if (!user) return null;
      // Per-user revocation: an admin password reset stamps the mark, and every token
      // issued before it dies here — the signed-world replacement for deleteByUser.
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
            newClaims(claims.u, claims.v, now.getTime(), this.deps.sessionTtlMs),
            this.deps.tokenSecret,
          ),
        };
      }
      return { user, via };
    }

    // A session from before tokens were signed: honored from its row until it expires, so
    // the upgrade logs nobody out. No new rows are ever written — this path only shrinks.
    const tokenHash = sha256Hex(token);
    const session = this.deps.authSessions.findByTokenHash(tokenHash);
    if (!session) return null;
    const expiresAt = Date.parse(session.expiresAt);
    if (!(expiresAt > now.getTime())) {
      this.deps.authSessions.delete(tokenHash);
      return null;
    }
    const user = this.deps.users.findById(session.userId);
    if (!user) return null;
    return { user, via: session.via === "desktop" ? "desktop" : "password" };
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
   */
  redeemOwnerToken(
    given: string,
    userId: string,
    ttlMs: number,
  ): { token: string; expiresAt: string } | "bad_token" | "no_user" {
    const expected = this.deps.ownerToken;
    if (expected === null || !ownerTokenMatches(given, expected)) return "bad_token";
    if (this.deps.users.findById(userId) === null) return "no_user";
    const bounded = Math.max(1_000, Math.min(ttlMs, this.deps.sessionTtlMs));
    const claims = newClaims(userId, "cli", this.now().getTime(), bounded);
    return {
      token: signToken(claims, this.deps.tokenSecret),
      expiresAt: new Date(claims.exp).toISOString(),
    };
  }
}
