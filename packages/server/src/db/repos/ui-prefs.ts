/**
 * ui_prefs table repo (UI preferences): free-form JSON storage.
 */
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { Db } from "../database.js";

@Component()
export class UiPrefsRepo {
  @Use() private readonly db!: Db;

  /** Returns the raw JSON string; null if never set. */
  get(userId: string): string | null {
    const r = this.db.prepare("SELECT prefs_json FROM ui_prefs WHERE user_id = ?").get(userId);
    return r ? (r.prefs_json as string) : null;
  }

  set(userId: string, prefsJson: string): void {
    this.db
      .prepare(
        `INSERT INTO ui_prefs (user_id, prefs_json) VALUES (?, ?)
         ON CONFLICT(user_id) DO UPDATE SET prefs_json = excluded.prefs_json`,
      )
      .run(userId, prefsJson);
  }
}
