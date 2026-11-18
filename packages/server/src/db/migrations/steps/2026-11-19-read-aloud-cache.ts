import type { Migration } from "../migration.js";

export const readAloudCache: Migration = {
  name: "2026-11-19-read-aloud-cache",
  swapSafe: true,
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS read_aloud_cache (
  fingerprint TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES capability_runs(id) ON DELETE CASCADE
);`);
  },
  down(db) {
    db.exec("DROP TABLE IF EXISTS read_aloud_cache");
  },
};
