/**
 * Revoked-before-expiry signed tokens — the ONLY per-session state the stateless scheme
 * keeps (see auth/token-codec.ts for the design). The table exists for restarts; the live
 * check is an in-memory Set the AuthService loads from here at construction, so the
 * per-request hot path never reads the database for revocation.
 *
 * Rows die with their token: once `expires_at` passes, the signature check refuses the
 * token on its own and the row is dead weight — deleteExpired sweeps them at boot and on
 * each login.
 */
import type { DatabaseSync } from "node:sqlite";

export class AuthRevocationsRepo {
  constructor(private readonly db: DatabaseSync) {}

  insert(jti: string, expiresAt: string): void {
    this.db
      .prepare("INSERT OR IGNORE INTO auth_revocations (jti, expires_at) VALUES (?, ?)")
      .run(jti, expiresAt);
  }

  /** Every live revocation with its expiry, for seeding the in-memory mirror at boot. */
  list(): { jti: string; expiresAt: string }[] {
    return this.db
      .prepare("SELECT jti, expires_at FROM auth_revocations")
      .all()
      .map((r) => {
        const row = r as { jti: unknown; expires_at: unknown };
        return { jti: String(row.jti), expiresAt: String(row.expires_at) };
      });
  }

  deleteExpired(nowIso: string): void {
    this.db.prepare("DELETE FROM auth_revocations WHERE expires_at <= ?").run(nowIso);
  }
}
