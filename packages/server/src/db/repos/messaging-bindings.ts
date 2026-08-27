/**
 * Repo for Session ↔ messaging-channel bot bindings (Feishu and Telegram today).
 *
 * A Session keeps at most one saved config PER channel — the `(session_id, channel)`
 * primary key — and both channels' credentials may sit saved side by side. Which of them
 * (at most one) holds a live connection is the per-row `enabled` intent; the
 * one-enabled-per-session invariant is enforced by the state route (409
 * `another_channel_enabled`), not here — the repo stays a dumb store.
 *
 * Saving is NOT exclusive across Sessions: any number of Sessions may keep the same bot
 * account saved side by side, each with its own config document and its own last-chat
 * memory, so `upsert` has no failure mode at all. The one cross-session rule sits on the
 * connection instead — enabling a binding whose account is already enabled on another
 * Session is refused by the state route (409 `account_enabled_elsewhere`), which reads
 * `findEnabledByAccount` to see it. One account has one event stream, so two live
 * connections on it are meaningless; two saved configs are not.
 *
 * `line_per_message` is a delivery preference rather than credentials, which is why it is a
 * column beside `enabled` and not a key inside `config`: that document is the channel's own
 * shape, owned by its connector, and this applies to every channel identically.
 *
 * `config` is the channel-specific credential/config document, stored as JSON. Secrets
 * inside it are plaintext at rest (same trade-off as the proxy address in
 * server_settings) and must be masked at every API surface — nothing here ever masks,
 * callers do. A cleared secret is stored as the empty string: the row, its non-secret
 * fields and its account identity stay. The repo does not interpret the document; each
 * channel's connector and route own its shape.
 */
import type { DatabaseSync } from "node:sqlite";

export interface MessagingBindingRow {
  sessionId: string;
  /** Messaging channel discriminator (`feishu` | `telegram`). */
  channel: string;
  /** Channel-scoped bot/app identity (feishu: the app_id; telegram: the bot token's numeric id); never secret. */
  accountId: string;
  /** Channel-specific config document (feishu: appId/appSecret/baseDomain; telegram: botToken). */
  config: Record<string, unknown>;
  /**
   * INTENT state: whether the binding should hold a live connection (the connection's
   * runtime status stays in memory). Saving credentials never flips it — only the
   * explicit state toggle does — and new bindings start disabled. Flipping it on is what
   * binds the account to this Session: at most one of a Session's rows is enabled, and at
   * most one row per `(channel, accountId)` is enabled across all Sessions (both
   * route-enforced).
   */
  enabled: boolean;
  /**
   * DELIVERY preference: send each non-blank line of a relayed assistant reply as its own
   * message instead of one message per reply. Off by default, and off reproduces the
   * original behaviour exactly. Ordinary saved state — the PUT owns it, like the config.
   */
  linePerMessage: boolean;
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
    linePerMessage: Number(r.line_per_message) === 1,
    lastChatId: (r.last_chat_id as string | null) ?? null,
    lastChatIsDirect: Number(r.last_chat_is_direct) === 1,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export class MessagingBindingsRepo {
  constructor(private readonly db: DatabaseSync) {}

  /** The Session's saved config of ONE channel (null when that channel is not configured). */
  find(sessionId: string, channel: string): MessagingBindingRow | null {
    const r = this.db
      .prepare("SELECT * FROM messaging_bindings WHERE session_id = ? AND channel = ?")
      .get(sessionId, channel);
    return r ? mapRow(r as Record<string, unknown>) : null;
  }

  /** The Session's enabled binding — at most one exists (route-enforced); null when all are dark. */
  findEnabled(sessionId: string): MessagingBindingRow | null {
    const r = this.db
      .prepare("SELECT * FROM messaging_bindings WHERE session_id = ? AND enabled = 1")
      .get(sessionId);
    return r ? mapRow(r as Record<string, unknown>) : null;
  }

  /** Every channel config the Session has saved, in stable channel order. */
  listForSession(sessionId: string): MessagingBindingRow[] {
    const rows = this.db
      .prepare("SELECT * FROM messaging_bindings WHERE session_id = ? ORDER BY channel")
      .all(sessionId);
    return rows.map((r) => mapRow(r as Record<string, unknown>));
  }

  /**
   * Whichever binding currently holds this account's connection — null while every Session
   * that saved the account keeps it dark. At most one row can match, for the same reason
   * `findEnabled` is at-most-one: the state route refuses the second enable, and its
   * guard-then-flip runs in one synchronous block, so two requests cannot interleave
   * between the check and the write.
   */
  findEnabledByAccount(channel: string, accountId: string): MessagingBindingRow | null {
    const r = this.db
      .prepare(
        "SELECT * FROM messaging_bindings WHERE channel = ? AND account_id = ? AND enabled = 1",
      )
      .get(channel, accountId);
    return r ? mapRow(r as Record<string, unknown>) : null;
  }

  listAll(): MessagingBindingRow[] {
    const rows = this.db
      .prepare("SELECT * FROM messaging_bindings ORDER BY session_id, channel")
      .all();
    return rows.map((r) => mapRow(r as Record<string, unknown>));
  }

  /**
   * Create or replace the Session's config for one channel — credentials/config only:
   * `enabled` is intent state the state toggle owns, so an insert starts disabled and an
   * update keeps the stored value. `linePerMessage` is an ordinary saved field this write
   * does own, and an omitted one keeps the stored value (a fresh row starts with it off).
   * It cannot fail on another Session: the same account saved elsewhere is none of this
   * write's business, since only enabling is exclusive.
   * Re-saving a Session's own binding keeps its last-chat memory, so a settings edit never
   * loses the reply target — unless the account changed, whose chats are unrelated: the
   * remembered chat is dropped so replies can never land in the old bot's conversation.
   */
  upsert(args: {
    sessionId: string;
    channel: string;
    accountId: string;
    config: Record<string, unknown>;
    linePerMessage?: boolean;
  }): MessagingBindingRow {
    const now = new Date().toISOString();
    const configJson = JSON.stringify(args.config);
    const existing = this.find(args.sessionId, args.channel);
    if (existing === null) {
      this.db
        .prepare(
          `INSERT INTO messaging_bindings
             (session_id, channel, account_id, config_json, line_per_message, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          args.sessionId,
          args.channel,
          args.accountId,
          configJson,
          args.linePerMessage === true ? 1 : 0,
          now,
          now,
        );
    } else {
      const keepChat = existing.accountId === args.accountId;
      this.db
        .prepare(
          `UPDATE messaging_bindings
             SET account_id = ?, config_json = ?,
                 line_per_message = COALESCE(?, line_per_message),
                 last_chat_id = CASE WHEN ? THEN last_chat_id ELSE NULL END,
                 last_chat_is_direct = CASE WHEN ? THEN last_chat_is_direct ELSE 1 END,
                 updated_at = ?
           WHERE session_id = ? AND channel = ?`,
        )
        .run(
          args.accountId,
          configJson,
          // NULL = the caller said nothing about it, and COALESCE keeps what is stored.
          args.linePerMessage === undefined ? null : args.linePerMessage ? 1 : 0,
          keepChat ? 1 : 0,
          keepChat ? 1 : 0,
          now,
          args.sessionId,
          args.channel,
        );
    }
    const row = this.find(args.sessionId, args.channel);
    if (!row) throw new Error("Failed to read back messaging_bindings after upsert");
    return row;
  }

  /** The state toggle's write: flip one channel's connection intent (the bridge then aligns the live connection). */
  setEnabled(sessionId: string, channel: string, enabled: boolean): void {
    this.db
      .prepare(
        `UPDATE messaging_bindings SET enabled = ?, updated_at = ?
         WHERE session_id = ? AND channel = ?`,
      )
      .run(enabled ? 1 : 0, new Date().toISOString(), sessionId, channel);
  }

  /** Remember the most recent inbound chat (the reply and test-message target; chats are channel-scoped). */
  recordChat(sessionId: string, channel: string, chatId: string, isDirect: boolean): void {
    this.db
      .prepare(
        `UPDATE messaging_bindings
           SET last_chat_id = ?, last_chat_is_direct = ?, updated_at = ?
         WHERE session_id = ? AND channel = ?`,
      )
      .run(chatId, isDirect ? 1 : 0, new Date().toISOString(), sessionId, channel);
  }

  /** Drop one channel's config. */
  delete(sessionId: string, channel: string): void {
    this.db
      .prepare("DELETE FROM messaging_bindings WHERE session_id = ? AND channel = ?")
      .run(sessionId, channel);
  }

  /** Drop every channel config of a Session (the session-delete cascade). */
  deleteSession(sessionId: string): void {
    this.db.prepare("DELETE FROM messaging_bindings WHERE session_id = ?").run(sessionId);
  }
}
