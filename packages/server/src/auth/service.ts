/**
 * Auth service: built-in admin seeding /
 * login / logout / password change / session validation.
 *
 * - No open registration: on startup, if there are no users at all, the built-in
 *   admin `admin` is seeded (initial password penguin-2026), and it adopts
 *   `default_project`; all other users are created by an admin via the user
 *   backend (admin-service).
 * - An initial password (whether seeded or set by an admin) is flagged with
 *   password_is_initial, which the frontend uses to prompt for a password change soon.
 * - Sessions: a 32-byte random token, with only its sha256 hash stored in the DB;
 *   valid for 7 days, with sliding renewal once less than 6 days remain.
 */
import { createHash, randomBytes } from "node:crypto";
import type { UserInfo } from "../api/types.js";
import { HttpError } from "../http/errors.js";
import type { AuthSessionsRepo } from "../db/repos/auth-sessions.js";
import type { UserRow, UsersRepo } from "../db/repos/users.js";
import { hashPassword, verifyPassword } from "./password.js";

export const MIN_PASSWORD_LENGTH = 8;

/** Built-in admin: user_id and initial password (matches the README and login-page hint). */
export const ADMIN_USER_ID = "admin";
export const ADMIN_INITIAL_PASSWORD = "penguin-2026";

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * How a session was established: "password" via the login form, "desktop" via the
 * desktop shell's one-shot token (see design § "桌面端原型 · 桌面登录"). Persisted per
 * session so desktop-specific allowances (password change without the old password)
 * apply only to sessions the shell itself opened. Legacy rows (NULL) read as "password".
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
   */
  async seedAdmin(): Promise<void> {
    if (this.deps.users.count() > 0) return;
    const user: UserRow = {
      userId: ADMIN_USER_ID,
      passwordHash: await hashPassword(ADMIN_INITIAL_PASSWORD),
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

  async login(userId: string, password: string): Promise<{ user: UserInfo; token: string }> {
    const row = this.deps.users.findById(userId);
    const ok = row !== null && (await verifyPassword(password, row.passwordHash));
    if (!row || !ok) {
      throw new HttpError(401, "invalid_credentials", "Incorrect username or password.");
    }
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
  }

  logout(token: string): void {
    this.deps.authSessions.delete(sha256Hex(token));
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
