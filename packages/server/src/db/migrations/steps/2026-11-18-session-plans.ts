import type { Migration } from "../migration.js";

export const sessionPlans: Migration = {
  name: "2026-11-18-session-plans",
  swapSafe: true,
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS session_plans (
  session_id TEXT PRIMARY KEY REFERENCES sessions(session_id) ON DELETE CASCADE,
  revision TEXT,
  proposal TEXT
);
`);
  },
  down(db) {
    db.exec("DROP TABLE IF EXISTS session_plans");
  },
};
