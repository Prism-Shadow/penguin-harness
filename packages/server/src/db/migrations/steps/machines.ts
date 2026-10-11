import type { Migration } from "../migration.js";

export const machines: Migration = {
  name: "machines",
  // Three new tables, nothing existing touched: a platform rolled back to one without
  // machines never queries them. Swap-safe on its own; a database still behind
  // drop-goal-state is refused whole by that one first, which is the rule.
  swapSafe: true,
  up(db) {
    // Frozen copy of the DDL as of the machines feature; do not re-derive from schema.ts.
    // IF NOT EXISTS because the declarative track may already have created them (RE-RUNNABLE in index.ts).
    db.exec(`
      CREATE TABLE IF NOT EXISTS machine (
        singleton  INTEGER PRIMARY KEY CHECK (singleton = 1),
        machine_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS machines (
        address      TEXT PRIMARY KEY,
        machine_id   TEXT,
        version      TEXT,
        installed_at TEXT,
        session_pid  INTEGER,
        remote_port  INTEGER,
        platform     TEXT
      );
      CREATE TABLE IF NOT EXISTS machine_project (
        project_id TEXT PRIMARY KEY REFERENCES projects(project_id) ON DELETE CASCADE,
        addresses  TEXT NOT NULL
      );
    `);
  },
  // LOSES this server's own machine id (every stored reference to it on other machines
  // then points at nothing), what was installed where, the sessions held, and which
  // machines each Project used.
  down(db) {
    db.exec(`
      DROP TABLE IF EXISTS machine_project;
      DROP TABLE IF EXISTS machines;
      DROP TABLE IF EXISTS machine;
    `);
  },
};
