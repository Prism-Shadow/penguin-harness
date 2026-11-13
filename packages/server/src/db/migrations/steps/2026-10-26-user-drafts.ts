import type { Migration } from "../migration.js";

export const userDrafts: Migration = {
  name: "2026-10-26-user-drafts",
  // Additive: two new tables and two indexes. A user's unsent drafts and the custom background
  // image, which used to live only in the browser that made them. A predecessor build never
  // reads either table, so a rollback survives it; its Web App then keeps drafts and the image
  // in that browser alone, as it always did.
  swapSafe: true,
  up(db) {
    // Frozen copy of the DDL as of the account-preferences change; do not re-derive from
    // schema.ts. IF NOT EXISTS because the declarative track may already have created them
    // (RE-RUNNABLE in index.ts).
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_drafts ( -- a user's unsent drafts (composer text, parked conversations, form answers), so they follow the account to another browser; bounded per user, dropped with the Session or Project they belong to
        user_id    TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        draft_key  TEXT NOT NULL,
        session_id TEXT,
        project_id TEXT,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, draft_key)
      );
      CREATE INDEX IF NOT EXISTS idx_user_drafts_session ON user_drafts(session_id);
      CREATE INDEX IF NOT EXISTS idx_user_drafts_project ON user_drafts(project_id);
      CREATE TABLE IF NOT EXISTS user_background_images ( -- the custom background image of a user's appearance settings, apart from ui_prefs so the megabyte it may hold is read only by the one route that serves it
        user_id    TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
        image      TEXT NOT NULL,
        image_id   TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  },
  // LOSES every draft and background image the accounts hold on the server. A browser that still
  // caches them keeps showing its own copy; another browser starts without them.
  down(db) {
    db.exec(`
      DROP INDEX IF EXISTS idx_user_drafts_project;
      DROP INDEX IF EXISTS idx_user_drafts_session;
      DROP TABLE IF EXISTS user_drafts;
      DROP TABLE IF EXISTS user_background_images;
    `);
  },
};
