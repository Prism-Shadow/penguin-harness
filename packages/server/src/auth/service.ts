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
import { hashPassword, verifyPassword } from "./password.js";

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
 * How a session was established: "password" via the login form, "desktop" via the
 * desktop shell's one-shot token. Persisted per session so desktop-specific allowances
 * (password change without the old password) apply only to sessions the shell itself
 * opened. Legacy rows (NULL) read as "password".
 */
export type SessionVia = "password" | "desktop";

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
  /**
   * Fired after any successful password update (self change / desktop set). The server
   * wires it to drop the stored initial-password plaintext once it goes stale (see
   * initial-password.ts); standalone/test constructions may omit it.
   */
  onPasswordChanged?: (userId: string) => void;
  sessionTtlMs: number;
  sessionRenewMs: number;
  now?: () => Date;
}

export class AuthService {
  private readonly now: () => Date;

  constructor(private readonly deps: AuthServiceDeps) {
    this.now = deps.now ?? (() => new Date());
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
      passwordHash: await hashPassword(password),
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
    return password;
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
    this.deps.users.updatePassword(userId, await hashPassword(newPassword), false);
    this.deps.onPasswordChanged?.(userId);
  }

  /**
   * Desktop-session password set: no old-password check. Only reachable for sessions
   * established via desktop-login (the me route gates on sessionVia) — the seed password
   * of a desktop-created root is random and never shown, so its holder has nothing to
   * type into an old-password field; the shell's token already proved machine ownership.
   */
  async setPasswordDesktop(userId: string, newPassword: string): Promise<void> {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new HttpError(400, "invalid_password", "Password must be at least 8 characters.");
    }
    this.deps.users.updatePassword(userId, await hashPassword(newPassword), false);
    this.deps.onPasswordChanged?.(userId);
  }

  logout(token: string): void {
    this.deps.authSessions.delete(sha256Hex(token));
  }

  /**
   * Who a token belongs to, WITHOUT the sliding renewal authenticateWithMeta performs:
   * the parked-session jar (routes/auth.ts) reads every token it holds on each listing,
   * and a read is not use — a parked session must age out on its own schedule rather
   * than being kept alive forever by the menu that lists it. Expired or unknown tokens
   * answer null (the expired row is dropped, as in authenticateWithMeta).
   */
  peekSession(token: string): { user: UserInfo; via: SessionVia } | null {
    const tokenHash = sha256Hex(token);
    const session = this.deps.authSessions.findByTokenHash(tokenHash);
    if (!session) return null;
    if (!(Date.parse(session.expiresAt) > this.now().getTime())) {
      this.deps.authSessions.delete(tokenHash);
      return null;
    }
    const row = this.deps.users.findById(session.userId);
    if (!row) return null;
    return { user: toUserInfo(row), via: session.via === "desktop" ? "desktop" : "password" };
  }

  /** Validates the cookie token: returns null if expired/unknown; sliding renewal once less than 6 days remain. */
  authenticateWithMeta(token: string): { user: UserRow; via: SessionVia } | null {
    const tokenHash = sha256Hex(token);
    const session = this.deps.authSessions.findByTokenHash(tokenHash);
    if (!session) return null;
    const now = this.now();
    const expiresAt = Date.parse(session.expiresAt);
    if (!(expiresAt > now.getTime())) {
      this.deps.authSessions.delete(tokenHash);
      return null;
    }
    if (expiresAt - now.getTime() < this.deps.sessionRenewMs) {
      this.deps.authSessions.touch(
        tokenHash,
        new Date(now.getTime() + this.deps.sessionTtlMs).toISOString(),
      );
    }
    const user = this.deps.users.findById(session.userId);
    if (!user) return null;
    return { user, via: session.via === "desktop" ? "desktop" : "password" };
  }

  private issueSession(userId: string, via: SessionVia): string {
    const token = randomBytes(32).toString("base64url");
    const now = this.now();
    this.deps.authSessions.insert({
      tokenHash: sha256Hex(token),
      userId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.deps.sessionTtlMs).toISOString(),
      via,
    });
    return token;
  }
}
