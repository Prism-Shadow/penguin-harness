/**
 * auth_sessions table repo (server-side sessions backing the HttpOnly cookie). Stores only
 * sha256(token); the raw token appears only in the cookie. `issue()` is the ONE minting point,
 * so a CLI-minted row cannot drift from one the server issues itself.
 */
import { createHash, randomBytes } from "node:crypto";
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { Db } from "../../hmr/capabilities.js";
import type { AuthSessions } from "../../mechanisms/identity.js";

/** How a session was established, as stored. NULL on rows formed before the column existed. */
export type SessionViaValue = "password" | "desktop" | "setup" | "cli";

export interface AuthSessionRow {
  tokenHash: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  via: SessionViaValue | null;
}

/** sha256 hex of a raw session token — the only form the database ever holds. */
export function sessionTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

@Component()
export class AuthSessionsRepo implements AuthSessions {
  @Use() private readonly db!: Db;

  /**
   * Mints a session and returns the raw token for a cookie or the terminal. `maxTtlMs` caps a
   * caller-supplied lifetime (`--ttl-seconds`): one longer than an ordinary session would make
   * a leaked token file outlive every other credential, sliding forever. Expired rows are
   * swept here too, so a cron that only mints does not accumulate them.
   */
  issue(opts: {
    userId: string;
    via: SessionViaValue;
    now: Date;
    ttlMs: number;
    maxTtlMs?: number;
  }): { token: string; expiresAt: string } {
    const ttlMs = Math.max(1_000, Math.min(opts.ttlMs, opts.maxTtlMs ?? opts.ttlMs));
    const token = randomBytes(32).toString("base64url");
    const createdAt = opts.now.toISOString();
    const expiresAt = new Date(opts.now.getTime() + ttlMs).toISOString();
    this.deleteExpired(createdAt);
    this.insert({
      tokenHash: sessionTokenHash(token),
      userId: opts.userId,
      createdAt,
      expiresAt,
      via: opts.via,
    });
    return { token, expiresAt };
  }

  insert(row: AuthSessionRow): void {
    this.db
      .prepare(
        "INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at, via) VALUES (?, ?, ?, ?, ?)",
      )
      .run(row.tokenHash, row.userId, row.createdAt, row.expiresAt, row.via);
  }

  findByTokenHash(tokenHash: string): AuthSessionRow | null {
    const r = this.db.prepare("SELECT * FROM auth_sessions WHERE token_hash = ?").get(tokenHash);
    if (!r) return null;
    return {
      tokenHash: r.token_hash as string,
      userId: r.user_id as string,
      createdAt: r.created_at as string,
      expiresAt: r.expires_at as string,
      via: (r.via as SessionViaValue | null) ?? null,
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

  /**
   * Clear a user's sessions of one kind. Used to end EVERY first-login session when a password
   * is set: an earlier boot's link may still be live in someone's scrollback, and a `setup`
   * session may change the password without knowing the old one.
   */
  deleteByUserAndVia(userId: string, via: SessionViaValue): void {
    this.db.prepare("DELETE FROM auth_sessions WHERE user_id = ? AND via = ?").run(userId, via);
  }
}
