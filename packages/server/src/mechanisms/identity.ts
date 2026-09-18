/**
 * The identity mechanisms: what a node may require, declared apart from what implements it.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { UserRow } from "../db/repos/users.js";
import type { AuthSessionRow, SessionViaValue } from "../db/repos/auth-sessions.js";
import type { UserInfo } from "../api/types.js";
import type { SessionVia } from "../auth/service.js";

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
  abstract changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void>;
  abstract setInitialPassword(userId: string, newPassword: string): Promise<void>;
  abstract logout(token: string): void;
  abstract localApiToken(): string | null;
  abstract authenticateApiToken(token: string): { user: UserRow; via: SessionVia } | null;
  abstract authenticateWithMeta(
    token: string,
  ): { user: UserRow; via: SessionVia; renewed: boolean } | null;
}

/** Admin: the mechanism AdminService implements. */
@Interface()
export abstract class Admin {
  abstract listUsers(): UserInfo[];
  abstract createUser(userId: string, password: string): Promise<UserInfo>;
  abstract resetPassword(userId: string, password: string): Promise<void>;
  abstract deleteUser(userId: string): Promise<void>;
}
