import type { Migration } from "../migration.js";

export const scheduleFirings: Migration = {
  name: "2026-10-20-schedule-firings",
  // One row per firing: which session a scheduled (or manual) fire went to and when.
  // Powers firing history and, downstream, run-based rules that join a firing to its
  // session's runs. Additive: older builds ignore the table.
  swapSafe: true,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schedule_firings (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        agent_id   TEXT NOT NULL,
        name       TEXT NOT NULL,
        session_id TEXT NOT NULL,
        fired_at   TEXT NOT NULL,
        manual     INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_schedule_firings_task ON schedule_firings(project_id, agent_id, name, fired_at);
    `);
  },
  // Keep the table and its rows on rollback: firing history is an audit trail, and
  // builds that predate the migration ignore tables they do not know. (A dropping down
  // would also break the shape round-trip every per-step test asserts.)
  down() {},
};
