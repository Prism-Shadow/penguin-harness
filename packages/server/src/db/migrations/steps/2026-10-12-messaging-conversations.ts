import type { Migration } from "../migration.js";

export const messagingConversations: Migration = {
  name: "2026-10-12-messaging-conversations",
  // Additive: one new table. The WeChat connector's per-(bot, user) delivery state — the
  // context token every send must echo, how many sends it has funded, and replies held for
  // the user's next message. A predecessor build never reads it and keeps its tokens in
  // memory as it always did, so a rollback survives it.
  swapSafe: true,
  up(db) {
    // Frozen copy of the DDL as of the WeChat delivery fix; do not re-derive from schema.ts.
    // IF NOT EXISTS because the declarative track may already have created it (ADOPTION).
    db.exec(`
      CREATE TABLE IF NOT EXISTS messaging_conversations ( -- per-(bot, chat) delivery state a connector must keep across reconnects and restarts (WeChat: the context token, its send count, held replies); deleted once no messaging_bindings row references (channel, account_id) — see MessagingBindingsRepo
        channel    TEXT NOT NULL,
        account_id TEXT NOT NULL,
        chat_id    TEXT NOT NULL,
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (channel, account_id, chat_id)
      );
    `);
  },
  // LOSES every stored context token and every held reply: replies sent before each user's
  // next message are refused again, and what was held never arrives.
  down(db) {
    db.exec("DROP TABLE IF EXISTS messaging_conversations");
  },
};
