/**
 * The identity mechanisms: what a node may require, declared apart from what implements it.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { UserRow } from "./repos/users.js";
import type { AuthSessionRow, SessionViaValue } from "./repos/auth-sessions.js";

/** Users: the mechanism UsersRepo implements. */
@Interface()
export abstract class Users {
  abstract insert(row: UserRow): void;
  abstract findById(userId: string): UserRow | null;
  abstract list(): UserRow[];
  abstract count(): number;
  abstract updatePassword(userId: string, passwordHash: string, isInitial: boolean): void;
  abstract updateProfile(
    userId: string,
    patch: { displayName?: string | null; avatar?: string | null },
  ): void;
  abstract delete(userId: string): void;
}

/** AuthSessions: the mechanism AuthSessionsRepo implements. */
@Interface()
export abstract class AuthSessions {
  abstract issue(opts: {
    userId: string;
    via: SessionViaValue;
    now: Date;
    ttlMs: number;
    maxTtlMs?: number;
  }): { token: string; expiresAt: string };
  abstract insert(row: AuthSessionRow): void;
  abstract findByTokenHash(tokenHash: string): AuthSessionRow | null;
  abstract touch(tokenHash: string, expiresAt: string): void;
  abstract delete(tokenHash: string): void;
  abstract deleteExpired(nowIso: string): void;
  abstract deleteByUser(userId: string): void;
  abstract deleteByUserAndVia(userId: string, via: SessionViaValue): void;
}

/** From packages/server: SessionVia (was auth/service.ts). The contract names it, so the type lives with the contract. */
export type SessionVia = "password" | "desktop" | "setup" | "remote" | "token";

/** Auth: the mechanism AuthService implements. */
@Interface()
export abstract class Auth {
  abstract readonly sessionTtlMs: number;
  abstract mintFirstLogin(): string | null;
  abstract adminPasswordIs(password: string): Promise<boolean>;
  abstract seedAdmin(): Promise<void>;
  abstract redeemFirstLogin(given: string): string | null;
  abstract adminPasswordIsInitial(): boolean;
  abstract login(userId: string, password: string): Promise<{ user: UserInfo; token: string }>;
  abstract loginDesktop(): { user: UserInfo; token: string };
  abstract issueRemoteSession(): { token: string; expiresAt: string; maxAgeSeconds: number };
  abstract changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void>;
  abstract setInitialPassword(userId: string, newPassword: string): Promise<void>;
  abstract logout(token: string): void;
  abstract localApiToken(): string | null;
  abstract authenticateApiToken(token: string): { user: UserRow; via: SessionVia } | null;
  abstract authenticateWithMeta(
    token: string,
  ): { user: UserRow; via: SessionVia; renewed: boolean } | null;
  abstract sessionIsLive(token: string): boolean;
  abstract isAdmin(userId: string): boolean;
}

/** From packages/server: UserInfo (was api/types.ts). The contract names it, so the type lives with the contract. */
export interface UserInfo {
  /** Semantic id, i.e. login name: `^[a-z][a-z0-9_-]{1,31}$`, immutable after creation. */
  userId: string;
  /** Built-in admin (seeded at startup). */
  isAdmin: boolean;
  /** Still using the initial password (seeded/set by admin): frontend prompts the user to change it soon. */
  passwordIsInitial: boolean;
  /**
   * Nickname the account chose (1-32 characters), shown wherever the id would otherwise be.
   * Omitted when unset — every account that predates the Profile page starts without one, and
   * a surface with no value falls back to `userId`.
   */
  displayName?: string;
  /**
   * Avatar as a `data:image/...;base64,` URL, at most 131072 characters. Omitted when unset,
   * and a surface with no value draws the letter placeholder instead.
   */
  avatar?: string;
  createdAt: string;
}

/** Admin: the mechanism AdminService implements. */
@Interface()
export abstract class Admin {
  abstract listUsers(): UserInfo[];
  abstract createUser(userId: string, password: string): Promise<UserInfo>;
  abstract resetPassword(userId: string, password: string): Promise<void>;
  abstract deleteUser(userId: string): Promise<void>;
}
