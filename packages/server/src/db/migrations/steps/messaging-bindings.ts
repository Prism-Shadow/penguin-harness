import type { Migration } from "../migration.js";

export const messagingBindings: Migration = {
  name: "messaging-bindings",
  // Purely additive: one new table plus three indexes, no column of any existing table
  // touched. A platform that rolls back to a predecessor without messaging simply never
  // queries them.
  swapSafe: true,
  up(db) {
    // 0.2.4 → 0.2.7. Frozen copy of the DDL as of 0.2.7; do not re-derive from schema.ts.
    // IF NOT EXISTS because a database from before migrations may already be at 0.2.7, and
    // because every migration is re-runnable (see index.ts).
    db.exec(`
      CREATE TABLE IF NOT EXISTS messaging_bindings (
        session_id       TEXT NOT NULL,
        channel          TEXT NOT NULL,
        account_id       TEXT NOT NULL,
        config_json      TEXT NOT NULL,
        enabled          INTEGER NOT NULL DEFAULT 0,
        line_per_message INTEGER NOT NULL DEFAULT 0,
        last_chat_id     TEXT,
        last_chat_is_direct INTEGER NOT NULL DEFAULT 1,
        last_inbound_message_id TEXT,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL,
        PRIMARY KEY (session_id, channel)
      );
      CREATE INDEX IF NOT EXISTS idx_messaging_by_account ON messaging_bindings(channel, account_id);
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
    `);
  },
  // LOSES every messaging binding: the channel credentials, the enabled flag and the
  // last-chat memory all live in the table this drops. The auth_sessions indexes are
  // derived and cost nothing to lose.
  down(db) {
    db.exec(`
      DROP INDEX IF EXISTS idx_auth_sessions_user;
      DROP INDEX IF EXISTS idx_auth_sessions_expires;
      DROP INDEX IF EXISTS idx_messaging_by_account;
      DROP TABLE IF EXISTS messaging_bindings;
    `);
  },
};
