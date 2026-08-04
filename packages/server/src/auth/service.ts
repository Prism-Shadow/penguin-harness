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

  async login(userId: string, password: string): Promise<{ user: UserInfo; token: string }> {
    const row = this.deps.users.findById(userId);
    const ok = row !== null && (await verifyPassword(password, row.passwordHash));
    if (!row || !ok) {
      throw new HttpError(401, "invalid_credentials", "Incorrect username or password.");
    }
    this.deps.authSessions.deleteExpired(this.now().toISOString());
    return { user: toUserInfo(row), token: this.issueSession(row.userId) };
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
  }

  logout(token: string): void {
    this.deps.authSessions.delete(sha256Hex(token));
  }

  /** Validates the cookie token: returns null if expired/unknown; sliding renewal once less than 6 days remain. */
  authenticate(token: string): UserRow | null {
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
    return this.deps.users.findById(session.userId);
  }

  private issueSession(userId: string): string {
    const token = randomBytes(32).toString("base64url");
    const now = this.now();
    this.deps.authSessions.insert({
      tokenHash: sha256Hex(token),
      userId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.deps.sessionTtlMs).toISOString(),
    });
    return token;
  }
}
