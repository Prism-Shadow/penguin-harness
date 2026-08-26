/**
 * Repo for Session ↔ messaging-channel bot bindings (Feishu is the only channel today).
 *
 * Two uniqueness rules, both enforced here: one messaging binding per Session (primary
 * key, whatever the channel) and one binding per bot account per channel (unique index on
 * `(channel, account_id)` — one account has one event stream, and two Sessions racing it
 * is meaningless). `upsert` reports the account conflict as a result value rather than
 * throwing, so a route can answer its channel's 409 (feishu: `feishu_app_in_use`) without
 * parsing SQLite errors.
 *
 * `config` is the channel-specific credential/config document, stored as JSON. Secrets
 * inside it are plaintext at rest (same trade-off as the proxy address in
 * server_settings) and must be masked at every API surface — nothing here ever masks,
 * callers do. The repo does not interpret the document; each channel's connector and
 * route own its shape.
 */
import type { DatabaseSync } from "node:sqlite";

export interface MessagingBindingRow {
  sessionId: string;
  /** Messaging channel discriminator (`feishu` is the only value today). */
  channel: string;
  /** Channel-scoped bot/app identity (feishu: the app_id); never secret. */
  accountId: string;
  /** Channel-specific config document (feishu: appId/appSecret/baseDomain). */
  config: Record<string, unknown>;
  /**
   * INTENT state: whether the binding should hold a live connection (the connection's
   * runtime status stays in memory). Saving credentials never flips it — only the
   * explicit state toggle does — and new bindings start disabled.
   */
  enabled: boolean;
  /** Most recent inbound chat (null until the bot is messaged once). */
  lastChatId: string | null;
  /** Whether that chat is a direct chat; group chats prefer reply-to-message. */
  lastChatIsDirect: boolean;
  createdAt: string;
  updatedAt: string;
}

function mapRow(r: Record<string, unknown>): MessagingBindingRow {
  let config: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(r.config_json as string);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      config = parsed as Record<string, unknown>;
    }
  } catch {
    // A malformed document reads as empty config; the connector then reports it malformed.
  }
  return {
    sessionId: r.session_id as string,
    channel: r.channel as string,
    accountId: r.account_id as string,
    config,
    enabled: Number(r.enabled) === 1,
    lastChatId: (r.last_chat_id as string | null) ?? null,
    lastChatIsDirect: Number(r.last_chat_is_direct) === 1,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export class MessagingBindingsRepo {
  constructor(private readonly db: DatabaseSync) {}

  find(sessionId: string): MessagingBindingRow | null {
    const r = this.db
      .prepare("SELECT * FROM messaging_bindings WHERE session_id = ?")
      .get(sessionId);
    return r ? mapRow(r as Record<string, unknown>) : null;
  }

  findByAccount(channel: string, accountId: string): MessagingBindingRow | null {
    const r = this.db
      .prepare("SELECT * FROM messaging_bindings WHERE channel = ? AND account_id = ?")
      .get(channel, accountId);
    return r ? mapRow(r as Record<string, unknown>) : null;
  }

  listAll(): MessagingBindingRow[] {
    const rows = this.db.prepare("SELECT * FROM messaging_bindings ORDER BY session_id").all();
    return rows.map((r) => mapRow(r as Record<string, unknown>));
  }

  /**
   * Create or replace the Session's binding — credentials/config only: `enabled` is
   * intent state the state toggle owns, so an insert starts disabled and an update keeps
   * the stored value. Returns `account_in_use` (writing nothing) when the
   * `(channel, accountId)` pair is already bound to a DIFFERENT Session; re-saving a
   * Session's own binding keeps its last-chat memory, so a settings edit never loses the
   * reply target — unless the account (or channel) changed, whose chats are unrelated:
   * the remembered chat is dropped so replies can never land in the old bot's
   * conversation.
   */
  upsert(args: {
    sessionId: string;
    channel: string;
    accountId: string;
    config: Record<string, unknown>;
  }): { ok: true; row: MessagingBindingRow } | { ok: false; reason: "account_in_use" } {
    const holder = this.findByAccount(args.channel, args.accountId);
    if (holder !== null && holder.sessionId !== args.sessionId) {
      return { ok: false, reason: "account_in_use" };
    }
    const now = new Date().toISOString();
    const configJson = JSON.stringify(args.config);
    const existing = this.find(args.sessionId);
    if (existing === null) {
      this.db
        .prepare(
          `INSERT INTO messaging_bindings
             (session_id, channel, account_id, config_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(args.sessionId, args.channel, args.accountId, configJson, now, now);
    } else {
      const keepChat = existing.channel === args.channel && existing.accountId === args.accountId;
      this.db
        .prepare(
          `UPDATE messaging_bindings
             SET channel = ?, account_id = ?, config_json = ?,
                 last_chat_id = CASE WHEN ? THEN last_chat_id ELSE NULL END,
                 last_chat_is_direct = CASE WHEN ? THEN last_chat_is_direct ELSE 1 END,
                 updated_at = ?
           WHERE session_id = ?`,
        )
        .run(
          args.channel,
          args.accountId,
          configJson,
          keepChat ? 1 : 0,
          keepChat ? 1 : 0,
          now,
          args.sessionId,
        );
    }
    const row = this.find(args.sessionId);
    if (!row) throw new Error("Failed to read back messaging_bindings after upsert");
    return { ok: true, row };
  }

  /** The state toggle's write: flip the connection intent (the bridge then aligns the live connection). */
  setEnabled(sessionId: string, enabled: boolean): void {
    this.db
      .prepare("UPDATE messaging_bindings SET enabled = ?, updated_at = ? WHERE session_id = ?")
      .run(enabled ? 1 : 0, new Date().toISOString(), sessionId);
  }

  /** Remember the most recent inbound chat (the reply and test-message target). */
  recordChat(sessionId: string, chatId: string, isDirect: boolean): void {
    this.db
      .prepare(
        `UPDATE messaging_bindings
           SET last_chat_id = ?, last_chat_is_direct = ?, updated_at = ?
         WHERE session_id = ?`,
      )
      .run(chatId, isDirect ? 1 : 0, new Date().toISOString(), sessionId);
  }

  delete(sessionId: string): void {
    this.db.prepare("DELETE FROM messaging_bindings WHERE session_id = ?").run(sessionId);
  }
}
