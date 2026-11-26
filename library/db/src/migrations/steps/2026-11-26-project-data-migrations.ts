import type { Migration } from "../migration.js";

export const projectDataMigrations: Migration = {
  name: "2026-11-26-project-data-migrations",
  // Additive: one new table. The one-time migrations of a Project's files this server has begun
  // and finished (the Self-Evolution Workbench's, packages/server's
  // services/rsi-workbench-migration.ts). A predecessor build never reads it, so a rollback
  // survives it.
  swapSafe: true,
  up(db) {
    // Frozen copy of the DDL as of PRFC-0036; do not re-derive from schema.ts. IF NOT EXISTS
    // because the declarative track may already have created it (RE-RUNNABLE in index.ts).
    db.exec(`
      CREATE TABLE IF NOT EXISTS project_data_migrations ( -- the one-time migrations of a Project's files this server has begun and finished; a finished row is never run again, a begun one is resumed from what is on disk
        name        TEXT NOT NULL,
        project_id  TEXT NOT NULL,
        begun_at    TEXT NOT NULL,
        finished_at TEXT,
        PRIMARY KEY (name, project_id)
      );
    `);
  },
  // LOSES the record of every one-time migration: the next boot looks at every Project again.
  // The Self-Evolution Workbench's finds nothing left to move, but installs the workbench once
  // more on a default Agent whose user removed it.
  down(db) {
    db.exec("DROP TABLE IF EXISTS project_data_migrations;");
  },
};
