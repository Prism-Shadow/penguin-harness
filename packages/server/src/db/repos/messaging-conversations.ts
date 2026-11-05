/**
 * Repo for per-(bot, chat) delivery state a messaging connector keeps across reconnects and
 * restarts — today WeChat's context token, how many sends it has funded, and the replies held
 * for the user's next message (see wechat-connector.ts).
 *
 * The state is a JSON document the connector owns, exactly like `messaging_bindings.config`:
 * the repo stores and returns it and interprets nothing. A row that does not parse reads as
 * absent, which the connector treats as a conversation it has never seen — the user's next
 * message rebuilds it.
 *
 * Rows have no lifetime of their own. They belong to the bot, not to a Session, and are deleted
 * by MessagingBindingsRepo once no binding references their `(channel, account_id)` any more —
 * and never written while none does: a conversation handle may not outlive every binding that
 * could use it.
 */
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { Db } from "../../hmr/capabilities.js";
import type { MessagingConversations } from "../../mechanisms/messaging.js";

/** Parses one stored document; null for anything that is not a JSON object. */
function stateOf(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

@Component()
export class MessagingConversationsRepo implements MessagingConversations {
  @Use() private readonly db!: Db;

  /** One chat's stored state, or null when none is stored (or it does not parse). */
  get(channel: string, accountId: string, chatId: string): Record<string, unknown> | null {
    const r = this.db
      .prepare(
        "SELECT state_json FROM messaging_conversations WHERE channel = ? AND account_id = ? AND chat_id = ?",
      )
      .get(channel, accountId, chatId);
    return r ? stateOf(r.state_json) : null;
  }

  /** Every stored chat of one bot, skipping documents that do not parse. */
  list(channel: string, accountId: string): { chatId: string; state: Record<string, unknown> }[] {
    const rows = this.db
      .prepare(
        "SELECT chat_id, state_json FROM messaging_conversations WHERE channel = ? AND account_id = ? ORDER BY chat_id",
      )
      .all(channel, accountId);
    return rows.flatMap((r) => {
      const state = stateOf(r.state_json);
      return state === null ? [] : [{ chatId: r.chat_id as string, state }];
    });
  }

  /**
   * Creates or replaces one chat's state — and does nothing for a bot no binding references.
   * The lifetime rule is enforced at the write as well as at the delete: a send still in flight
   * when the last binding went would otherwise write its bookkeeping back after the delete, and
   * the bot's next binding would inherit it.
   */
  put(channel: string, accountId: string, chatId: string, state: Record<string, unknown>): void {
    this.db
      .prepare(
        // The WHERE also keeps SQLite from reading ON CONFLICT as part of the SELECT.
        `INSERT INTO messaging_conversations (channel, account_id, chat_id, state_json, updated_at)
         SELECT ?, ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM messaging_bindings b WHERE b.channel = ? AND b.account_id = ?
         )
         ON CONFLICT (channel, account_id, chat_id)
         DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`,
      )
      .run(
        channel,
        accountId,
        chatId,
        JSON.stringify(state),
        new Date().toISOString(),
        channel,
        accountId,
      );
  }
}
