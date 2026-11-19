import type { Migration } from "../migration.js";

export const capabilityRuns: Migration = {
  name: "2026-11-18-capability-runs",
  swapSafe: true,
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS capability_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  session_id TEXT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS capability_runs_project_time ON capability_runs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS capability_runs_session_time ON capability_runs(project_id, session_id, created_at DESC);
`);
  },
  // Reverting removes the model-tool run index, including its metering and artifact references.
  down(db) {
    db.exec("DROP TABLE IF EXISTS capability_runs");
  },
};
