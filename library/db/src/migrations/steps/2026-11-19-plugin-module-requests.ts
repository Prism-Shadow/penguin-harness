import type { Migration } from "../migration.js";

export const pluginModuleRequests: Migration = {
  name: "2026-11-19-plugin-module-requests",
  // Additive: one new table. Who asked this server to run a plugin's server module and what an
  // administrator decided (PRFC-0031). A predecessor build never reads it, so a rollback survives
  // it; the plugin tables, which say what runs, are untouched.
  swapSafe: true,
  up(db) {
    // Frozen copy of the DDL as of PRFC-0031; do not re-derive from schema.ts. IF NOT EXISTS
    // because the declarative track may already have created it (RE-RUNNABLE in index.ts).
    db.exec(`
      CREATE TABLE IF NOT EXISTS plugin_module_requests ( -- who asked this server to run a plugin's server module, and what an administrator decided; one row per package. The record of asks and decisions, not of what runs: the plugin tables are that
        package      TEXT PRIMARY KEY,
        plugin       TEXT NOT NULL,
        project_id   TEXT REFERENCES projects(project_id) ON DELETE SET NULL,
        agent_id     TEXT,
        requested_by TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        decision     TEXT,
        decided_by   TEXT,
        decided_at   TEXT,
        via          TEXT
      );
    `);
  },
  // LOSES every pending request and every recorded decision, a decline included: a module an
  // administrator stopped comes back with the next install of its plugin. The plugin tables keep
  // what they list, so what runs does not change.
  down(db) {
    db.exec("DROP TABLE IF EXISTS plugin_module_requests;");
  },
};
