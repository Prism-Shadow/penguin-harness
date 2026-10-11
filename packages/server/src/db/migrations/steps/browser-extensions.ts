import type { Migration } from "../migration.js";

export const browserExtensions: Migration = {
  name: "browser-extensions",
  // Additive: one new table and its index. The Chrome backend's pairings — one row per
  // PenguinHarness Browser extension a user paired, its token stored hashed. A predecessor
  // build never reads the table, so a rollback survives it; the paired extensions then simply
  // fail to connect until a build that knows them is back.
  swapSafe: true,
  up(db) {
    // Frozen copy of the DDL as of the system-Chrome feature; do not re-derive from schema.ts.
    // IF NOT EXISTS because the declarative track may already have created it (RE-RUNNABLE in
    // index.ts).
    db.exec(`
      CREATE TABLE IF NOT EXISTS browser_extensions ( -- one row per Chrome paired to a user (builtin-browser/extension-pairing.ts): the PenguinHarness Browser extension's long-lived credential, stored only hashed; NOT rebuildable — a lost row means pairing that Chrome again
        extension_id TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        token_hash   TEXT NOT NULL UNIQUE,
        name         TEXT NOT NULL,
        version      TEXT NOT NULL,
        created_at   TEXT NOT NULL,
        last_seen_at TEXT,
        revoked_at   TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_browser_extensions_user ON browser_extensions(user_id);
    `);
  },
  // LOSES every pairing: each user's Chrome has to be paired again (a new code from the
  // Browser panel) before agents can drive it.
  down(db) {
    db.exec(`
      DROP INDEX IF EXISTS idx_browser_extensions_user;
      DROP TABLE IF EXISTS browser_extensions;
    `);
  },
};
