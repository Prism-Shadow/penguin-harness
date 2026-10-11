import type { Migration } from "../migration.js";

export const modelPromotions: Migration = {
  name: "model-promotions",
  // Additive: one new table, nothing existing touched. A predecessor build never reads it
  // and prices every row at the number in its Project file, so a rollback survives it.
  swapSafe: true,
  up(db) {
    // Frozen copy of the DDL as of the model-promotions feature; do not re-derive from
    // schema.ts. IF NOT EXISTS because the declarative track may already have created it
    // (RE-RUNNABLE in index.ts).
    db.exec(`
      CREATE TABLE IF NOT EXISTS model_promotions ( -- NOT a cache rebuildable from files: the only record of a Project row's running promotion (.project_config.toml keeps the list price), written by preset seeding at Project creation, "sync presets" and Penguin Go authorization / sync, and read by cost; lost rows price usage at list until the next sync writes them back
        project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
        provider   TEXT NOT NULL,
        model_id   TEXT NOT NULL,
        discount   REAL NOT NULL CHECK (discount > 0 AND discount < 1),
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, provider, model_id)
      );
    `);
  },
  // LOSES every stored promotion: no file holds a copy of the fractions, so usage is priced
  // at the Project files' list prices until the next "sync presets" or Penguin Go sync
  // writes them back.
  down(db) {
    db.exec("DROP TABLE IF EXISTS model_promotions");
  },
};
