import type { Migration } from "../migration.js";

export const pluginModulePreinstalls: Migration = {
  name: "2026-11-19-plugin-module-preinstalls",
  // Additive: one new table. The preinstalled built-in packages this server has already listed
  // once in every Project it had (PRFC-0030). A predecessor build never reads it, so a rollback
  // survives it; the plugin tables, which say what runs, are untouched.
  swapSafe: true,
  up(db) {
    // Frozen copy of the DDL as of PRFC-0030; do not re-derive from schema.ts. IF NOT EXISTS
    // because the declarative track may already have created it (RE-RUNNABLE in index.ts).
    db.exec(`
      CREATE TABLE IF NOT EXISTS plugin_module_preinstalls ( -- the preinstalled built-in packages this server has listed once in every Project it had; one row per package. After that the Project tables are the administrator's: a package here is never listed into an existing Project again
        package   TEXT PRIMARY KEY,
        listed_at TEXT NOT NULL
      );
    `);
  },
  // LOSES the record of every one-time listing: the next boot lists each preinstalled module in
  // every Project again, undoing an administrator's removal of it from a Project's table.
  down(db) {
    db.exec("DROP TABLE IF EXISTS plugin_module_preinstalls;");
  },
};
