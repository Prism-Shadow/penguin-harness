/**
 * Repo for Session ↔ Feishu bot bindings.
 *
 * Two uniqueness rules, both enforced here: one binding per Session (primary key) and one
 * binding per Feishu app (unique index on app_id — two Sessions on the same app would race
 * that app's single long-connection event stream). `upsert` reports the app_id conflict as
 * a result value rather than throwing, so the route can answer 409 `feishu_app_in_use`
 * without parsing SQLite errors.
 *
 * The secret is stored plaintext (same trade-off as the proxy address in server_settings)
 * and must be masked at every API surface — nothing here ever masks, callers do.
 */
import type { DatabaseSync } from "node:sqlite";

export interface FeishuBindingRow {
  sessionId: string;
  appId: string;
  appSecret: string;
  baseDomain: string;
  enabled: boolean;
  /** Most recent inbound chat (null until the bot is messaged once). */
  lastChatId: string | null;
  /** Whether that chat is a direct (p2p) chat; group chats prefer reply-to-message. */
  lastChatIsP2p: boolean;
  createdAt: string;
  updatedAt: string;
}

function mapRow(r: Record<string, unknown>): FeishuBindingRow {
  return {
    sessionId: r.session_id as string,
    appId: r.app_id as string,
    appSecret: r.app_secret as string,
    baseDomain: r.base_domain as string,
    enabled: Number(r.enabled) === 1,
    lastChatId: (r.last_chat_id as string | null) ?? null,
    lastChatIsP2p: Number(r.last_chat_is_p2p) === 1,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export class FeishuBindingsRepo {
  constructor(private readonly db: DatabaseSync) {}

  find(sessionId: string): FeishuBindingRow | null {
    const r = this.db.prepare("SELECT * FROM feishu_bindings WHERE session_id = ?").get(sessionId);
    return r ? mapRow(r as Record<string, unknown>) : null;
  }

  findByAppId(appId: string): FeishuBindingRow | null {
    const r = this.db.prepare("SELECT * FROM feishu_bindings WHERE app_id = ?").get(appId);
    return r ? mapRow(r as Record<string, unknown>) : null;
  }

  listAll(): FeishuBindingRow[] {
    const rows = this.db.prepare("SELECT * FROM feishu_bindings ORDER BY session_id").all();
    return rows.map((r) => mapRow(r as Record<string, unknown>));
  }

  listEnabled(): FeishuBindingRow[] {
    return this.listAll().filter((r) => r.enabled);
  }

  /**
   * Create or replace the Session's binding. Returns `app_in_use` (writing nothing) when
   * the app_id is already bound to a DIFFERENT Session; re-saving a Session's own binding
   * keeps its last-chat memory, so a settings edit never loses the reply target.
   */
  upsert(args: {
    sessionId: string;
    appId: string;
    appSecret: string;
    baseDomain: string;
    enabled: boolean;
  }): { ok: true; row: FeishuBindingRow } | { ok: false; reason: "app_in_use" } {
    const holder = this.findByAppId(args.appId);
    if (holder !== null && holder.sessionId !== args.sessionId) {
      return { ok: false, reason: "app_in_use" };
    }
    const now = new Date().toISOString();
    const existing = this.find(args.sessionId);
    if (existing === null) {
      this.db
        .prepare(
          `INSERT INTO feishu_bindings
             (session_id, app_id, app_secret, base_domain, enabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          args.sessionId,
          args.appId,
          args.appSecret,
          args.baseDomain,
          args.enabled ? 1 : 0,
          now,
          now,
        );
    } else {
      // A changed app_id points at a different bot whose chats are unrelated: drop the
      // remembered chat so replies can never land in the old app's conversation.
      const keepChat = existing.appId === args.appId;
      this.db
        .prepare(
          `UPDATE feishu_bindings
             SET app_id = ?, app_secret = ?, base_domain = ?, enabled = ?,
                 last_chat_id = CASE WHEN ? THEN last_chat_id ELSE NULL END,
                 last_chat_is_p2p = CASE WHEN ? THEN last_chat_is_p2p ELSE 1 END,
                 updated_at = ?
           WHERE session_id = ?`,
        )
        .run(
          args.appId,
          args.appSecret,
          args.baseDomain,
          args.enabled ? 1 : 0,
          keepChat ? 1 : 0,
          keepChat ? 1 : 0,
          now,
          args.sessionId,
        );
    }
    const row = this.find(args.sessionId);
    if (!row) throw new Error("Failed to read back feishu_bindings after upsert");
    return { ok: true, row };
  }

  /** Remember the most recent inbound chat (the reply and test-message target). */
  recordChat(sessionId: string, chatId: string, isP2p: boolean): void {
    this.db
      .prepare(
        `UPDATE feishu_bindings
           SET last_chat_id = ?, last_chat_is_p2p = ?, updated_at = ?
         WHERE session_id = ?`,
      )
      .run(chatId, isP2p ? 1 : 0, new Date().toISOString(), sessionId);
  }

  delete(sessionId: string): void {
    this.db.prepare("DELETE FROM feishu_bindings WHERE session_id = ?").run(sessionId);
  }
}
