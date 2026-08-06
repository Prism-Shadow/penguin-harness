/**
 * server_settings table repo (admin-level server-global settings): key-value storage
 * with JSON-encoded values. An absent row means the setting's built-in default, so
 * settings added after a web.db was formed need no migration.
 */
import type { DatabaseSync } from "node:sqlite";

/** Key of the "use system HTTP proxy" switch (design § "出网与系统代理"); default on. */
const USE_SYSTEM_PROXY_KEY = "use_system_proxy";

export class ServerSettingsRepo {
  constructor(private readonly db: DatabaseSync) {}

  /** Returns the raw JSON-encoded value; null if never set. */
  get(key: string): string | null {
    const r = this.db.prepare("SELECT value FROM server_settings WHERE key = ?").get(key);
    return r ? (r.value as string) : null;
  }

  set(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO server_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }

  /** The "use system HTTP proxy" switch; an absent (or unreadable) row reads as the default: on. */
  getUseSystemProxy(): boolean {
    return this.get(USE_SYSTEM_PROXY_KEY) !== "false";
  }

  setUseSystemProxy(value: boolean): void {
    this.set(USE_SYSTEM_PROXY_KEY, JSON.stringify(value));
  }
}
