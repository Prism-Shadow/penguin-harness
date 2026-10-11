import type { Migration } from "../migration.js";

export const companyModeChannels: Migration = {
  name: "company-mode-channels",
  // The organization's single group chat became channels: a message lives in
  // `channels/<channel_id>/<date>.jsonl`, so the tail-scan cursor and each user's read
  // cursor are per channel. `org_chat_state` / `org_chat_reads` are dropped for
  // `org_channel_state` / `org_channel_reads`: the tables are renamed and the channel
  // belongs in the primary key, neither of which SQLite does in place. Nothing is carried
  // over: company mode is unreleased, and every row was either rebuildable from the files
  // (the scan cursor) or one pass of "everything looks unread" (the read cursor). A
  // predecessor build reads neither table's shape, only its own writes, so this is
  // swap-safe.
  //
  // By the expand / contract rule (migration.ts) the two DROPs are a contract, and this is the
  // one expand that removes anything on the swap path. It stays an expand because it is frozen
  // and cannot be deferred: the same step creates the channel tables a pushed platform needs.
  // A new change of this kind is split into an expand and a later contract instead.
  swapSafe: true,
  up(db) {
    db.exec(`
      DROP TABLE IF EXISTS org_chat_state;
      DROP TABLE IF EXISTS org_chat_reads;
      CREATE TABLE IF NOT EXISTS org_channel_state ( -- DERIVED CACHE (company mode): tail-scan byte cursor per channel and day file
        project_id   TEXT NOT NULL,
        org_id       TEXT NOT NULL,
        channel_id   TEXT NOT NULL,
        date         TEXT NOT NULL,
        offset_bytes INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (project_id, org_id, channel_id, date)
      );
      CREATE TABLE IF NOT EXISTS org_channel_reads ( -- user data (company mode): each user's read cursor in one channel
        project_id   TEXT NOT NULL,
        org_id       TEXT NOT NULL,
        channel_id   TEXT NOT NULL,
        user_id      TEXT NOT NULL,
        last_read_id TEXT NOT NULL,
        PRIMARY KEY (project_id, org_id, channel_id, user_id)
      );
    `);
  },
  // Recreates the two tables under their old names, exactly as company-mode-org-caches declared them —
  // EMPTY. LOSES every scan cursor (re-derived by the next pass, which republishes the
  // messages it re-reads) and every read cursor (users see the recent days as unread once).
  down(db) {
    db.exec(`
      DROP TABLE IF EXISTS org_channel_state;
      DROP TABLE IF EXISTS org_channel_reads;
      CREATE TABLE IF NOT EXISTS org_chat_state (     -- DERIVED CACHE (company mode): tail-scan byte cursor per chat day file
        project_id   TEXT NOT NULL,
        org_id       TEXT NOT NULL,
        date         TEXT NOT NULL,
        offset_bytes INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (project_id, org_id, date)
      );
      CREATE TABLE IF NOT EXISTS org_chat_reads ( -- user data (company mode): each user's read cursor in an organization's chat
        project_id   TEXT NOT NULL,
        org_id       TEXT NOT NULL,
        user_id      TEXT NOT NULL,
        last_read_id TEXT NOT NULL,
        PRIMARY KEY (project_id, org_id, user_id)
      );
    `);
  },
};
