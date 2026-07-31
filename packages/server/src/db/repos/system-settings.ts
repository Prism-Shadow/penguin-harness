/**
 * System-wide settings: a small string key/value store for values shared by every user,
 * Project, Agent, and Session.
 */
import type { DatabaseSync } from "node:sqlite";

export class SystemSettingsRepo {
  constructor(private readonly db: DatabaseSync) {}

  get(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM system_settings WHERE key = ?").get(key) as
      { value?: unknown } | undefined;
    return typeof row?.value === "string" ? row.value : null;
  }

  set(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO system_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }
}
