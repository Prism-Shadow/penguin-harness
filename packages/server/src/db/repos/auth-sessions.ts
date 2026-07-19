/**
 * auth_sessions table repo (server-side sessions backing the HttpOnly cookie).
 *
 * Stores only the sha256(token) hex hash; the raw token appears only in the cookie.
 */
import type { DatabaseSync } from "node:sqlite";

export interface AuthSessionRow {
  tokenHash: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

export class AuthSessionsRepo {
  constructor(private readonly db: DatabaseSync) {}

  insert(row: AuthSessionRow): void {
    this.db
      .prepare(
        "INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
      )
      .run(row.tokenHash, row.userId, row.createdAt, row.expiresAt);
  }

  findByTokenHash(tokenHash: string): AuthSessionRow | null {
    const r = this.db.prepare("SELECT * FROM auth_sessions WHERE token_hash = ?").get(tokenHash);
    if (!r) return null;
    return {
      tokenHash: r.token_hash as string,
      userId: r.user_id as string,
      createdAt: r.created_at as string,
      expiresAt: r.expires_at as string,
    };
  }

  /** Sliding renewal: update the expiration time. */
  touch(tokenHash: string, expiresAt: string): void {
    this.db
      .prepare("UPDATE auth_sessions SET expires_at = ? WHERE token_hash = ?")
      .run(expiresAt, tokenHash);
  }

  delete(tokenHash: string): void {
    this.db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(tokenHash);
  }

  /** Opportunistically clean up expired sessions (called during login/validation). */
  deleteExpired(nowIso: string): void {
    this.db.prepare("DELETE FROM auth_sessions WHERE expires_at < ?").run(nowIso);
  }

  /** Clear all sessions for a user (forces re-login after an admin resets the password). */
  deleteByUser(userId: string): void {
    this.db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(userId);
  }
}
