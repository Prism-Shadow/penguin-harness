/**
 * users table repo: pure SQL wrapper, no business rules.
 * user_id is the login name (a semantic id, specified at creation, immutable).
 */
import type { DatabaseSync } from "node:sqlite";

export interface UserRow {
  userId: string;
  passwordHash: string;
  isAdmin: boolean;
  /** Still using the initial password (seeded / set by an admin); cleared to 0 once the user changes it. */
  passwordIsInitial: boolean;
  createdAt: string;
}

function mapRow(r: Record<string, unknown>): UserRow {
  return {
    userId: r.user_id as string,
    passwordHash: r.password_hash as string,
    isAdmin: (r.is_admin as number) === 1,
    passwordIsInitial: (r.password_is_initial as number) === 1,
    createdAt: r.created_at as string,
  };
}

export class UsersRepo {
  constructor(private readonly db: DatabaseSync) {}

  insert(row: UserRow): void {
    this.db
      .prepare(
        "INSERT INTO users (user_id, password_hash, is_admin, password_is_initial, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        row.userId,
        row.passwordHash,
        row.isAdmin ? 1 : 0,
        row.passwordIsInitial ? 1 : 0,
        row.createdAt,
      );
  }

  findById(userId: string): UserRow | null {
    const r = this.db.prepare("SELECT * FROM users WHERE user_id = ?").get(userId);
    return r ? mapRow(r) : null;
  }

  /** All users (for the admin user backend), ordered by creation time ascending. */
  list(): UserRow[] {
    const rows = this.db.prepare("SELECT * FROM users ORDER BY created_at ASC, user_id ASC").all();
    return rows.map(mapRow);
  }

  count(): number {
    const r = this.db.prepare("SELECT COUNT(*) AS n FROM users").get();
    return (r?.n as number) ?? 0;
  }

  /** Update the password hash; isInitial marks whether the password was set by someone else (seed / admin). */
  updatePassword(userId: string, passwordHash: string, isInitial: boolean): void {
    this.db
      .prepare("UPDATE users SET password_hash = ?, password_is_initial = ? WHERE user_id = ?")
      .run(passwordHash, isInitial ? 1 : 0, userId);
  }

  /** Used by admin user deletion and account-creation compensation paths (owned Projects must be cleaned up first). */
  delete(userId: string): void {
    this.db.prepare("DELETE FROM users WHERE user_id = ?").run(userId);
  }
}
