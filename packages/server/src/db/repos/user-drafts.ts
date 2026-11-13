/**
 * user_drafts table repo: each user's unsent drafts, by key. What a key may be and how large a
 * draft may grow is services/user-drafts.ts; this only stores, bounds and forgets rows.
 */
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { Db } from "../../hmr/capabilities.js";
import type { DraftWrite, StoredDraft, UserDraftsStore } from "../../mechanisms/account-data.js";

@Component()
export class UserDraftsRepo implements UserDraftsStore {
  @Use() private readonly db!: Db;

  list(userId: string): StoredDraft[] {
    const rows = this.db
      .prepare("SELECT draft_key, value_json FROM user_drafts WHERE user_id = ? ORDER BY draft_key")
      .all(userId) as { draft_key: string; value_json: string }[];
    return rows.map((r) => ({ key: r.draft_key, valueJson: r.value_json }));
  }

  apply(
    userId: string,
    writes: readonly DraftWrite[],
    bounds: { maxCount: number; maxChars: number },
  ): void {
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const upsert = this.db.prepare(
        `INSERT INTO user_drafts (user_id, draft_key, session_id, project_id, value_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, draft_key) DO UPDATE SET
           session_id = excluded.session_id,
           project_id = excluded.project_id,
           value_json = excluded.value_json,
           updated_at = excluded.updated_at`,
      );
      const remove = this.db.prepare("DELETE FROM user_drafts WHERE user_id = ? AND draft_key = ?");
      for (const w of writes) {
        if (w.valueJson === null) remove.run(userId, w.key);
        else upsert.run(userId, w.key, w.sessionId, w.projectId, w.valueJson, now);
      }
      this.evict(userId, new Set(writes.map((w) => w.key)), bounds);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  /**
   * Drops the least recently written drafts until the user is within both bounds. The drafts
   * this write just touched are never dropped: what a browser has just saved must be there when
   * it reads back.
   */
  private evict(
    userId: string,
    keep: ReadonlySet<string>,
    bounds: { maxCount: number; maxChars: number },
  ): void {
    const rows = this.db
      .prepare(
        `SELECT draft_key, LENGTH(value_json) AS chars FROM user_drafts
         WHERE user_id = ? ORDER BY updated_at ASC, draft_key ASC`,
      )
      .all(userId) as { draft_key: string; chars: number }[];
    let count = rows.length;
    let chars = rows.reduce((sum, r) => sum + r.chars, 0);
    const remove = this.db.prepare("DELETE FROM user_drafts WHERE user_id = ? AND draft_key = ?");
    for (const row of rows) {
      if (count <= bounds.maxCount && chars <= bounds.maxChars) return;
      if (keep.has(row.draft_key)) continue;
      remove.run(userId, row.draft_key);
      count -= 1;
      chars -= row.chars;
    }
  }

  deleteBySession(sessionId: string): void {
    this.db.prepare("DELETE FROM user_drafts WHERE session_id = ?").run(sessionId);
  }

  deleteByProject(projectId: string): void {
    // The Session-keyed drafts are found through the Session index, so this runs before the
    // Project's index rows go.
    this.db
      .prepare(
        `DELETE FROM user_drafts WHERE project_id = ?
           OR session_id IN (SELECT session_id FROM sessions WHERE project_id = ?)`,
      )
      .run(projectId, projectId);
  }

  deleteByAgent(projectId: string, agentId: string): void {
    this.db
      .prepare(
        `DELETE FROM user_drafts
         WHERE session_id IN (SELECT session_id FROM sessions WHERE project_id = ? AND agent_id = ?)`,
      )
      .run(projectId, agentId);
  }
}
