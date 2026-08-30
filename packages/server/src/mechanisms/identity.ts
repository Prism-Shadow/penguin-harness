/**
 * The identity mechanisms: what a node may require, declared apart from what implements it.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { UserRow } from "../db/repos/users.js";
import type { AuthSessionRow, SessionViaValue } from "../db/repos/auth-sessions.js";
import type { UserInfo } from "../api/types.js";
import type { SessionVia } from "../auth/service.js";

/** Users: the mechanism UsersRepo implements. */
export abstract class Users extends Interface<{
  insert(row: UserRow): void;
  findById(userId: string): UserRow | null;
  list(): UserRow[];
  count(): number;
  updatePassword(userId: string, passwordHash: string, isInitial: boolean): void;
  delete(userId: string): void;
}>() {}

/** AuthSessions: the mechanism AuthSessionsRepo implements. */
export abstract class AuthSessions extends Interface<{
  issue(opts: {
    userId: string;
    via: SessionViaValue;
    now: Date;
    ttlMs: number;
    maxTtlMs?: number;
  }): { token: string; expiresAt: string };
  insert(row: AuthSessionRow): void;
  findByTokenHash(tokenHash: string): AuthSessionRow | null;
  touch(tokenHash: string, expiresAt: string): void;
  delete(tokenHash: string): void;
  deleteExpired(nowIso: string): void;
  deleteByUser(userId: string): void;
  deleteByUserAndVia(userId: string, via: SessionViaValue): void;
}>() {}

/** Auth: the mechanism AuthService implements. */
export abstract class Auth extends Interface<{
  readonly sessionTtlMs: number;
  mintFirstLogin(): string | null;
  adminPasswordIs(password: string): Promise<boolean>;
  seedAdmin(): Promise<void>;
  redeemFirstLogin(given: string): string | null;
  adminPasswordIsInitial(): boolean;
  login(userId: string, password: string): Promise<{ user: UserInfo; token: string }>;
  loginDesktop(): { user: UserInfo; token: string };
  changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void>;
  setInitialPassword(userId: string, newPassword: string): Promise<void>;
  logout(token: string): void;
  localApiToken(): string | null;
  authenticateApiToken(token: string): { user: UserRow; via: SessionVia } | null;
  authenticateWithMeta(token: string): { user: UserRow; via: SessionVia; renewed: boolean } | null;
}>() {}

/** Admin: the mechanism AdminService implements. */
export abstract class Admin extends Interface<{
  listUsers(): UserInfo[];
  createUser(userId: string, password: string): Promise<UserInfo>;
  resetPassword(userId: string, password: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
}>() {}
