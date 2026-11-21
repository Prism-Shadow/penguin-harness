import type { Migration } from "../migration.js";

export const portForwardsAdoption: Migration = {
  name: "2026-10-11-port-forwards-adoption",
  // A root can come to hold this migration's ledger record — or the base migration's, carried
  // in a database that traveled between machines and lines — without the table behind it. The
  // port-forwards module reads the table at start, so a root without it exits before it
  // listens. Re-runs the base migration's `up` — the frozen first DDL, all `IF NOT EXISTS`, so
  // a root that has the table finds its work done and nothing changes. Remove together with
  // the ledger's adoption of roots that have no ledger of their own (index.ts).
  swapSafe: true,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS port_forwards (
        id          TEXT PRIMARY KEY,
        machine_id  TEXT NOT NULL,
        workspace   TEXT NOT NULL,
        remote_port INTEGER NOT NULL,
        local_port  INTEGER NOT NULL UNIQUE,
        created_at  TEXT NOT NULL,
        UNIQUE (machine_id, workspace, remote_port)
      );
      CREATE INDEX IF NOT EXISTS idx_port_forwards_machine ON port_forwards(machine_id, workspace);
    `);
  },
  // Nothing to undo: the table is port-forwards', and its own down drops it.
  down() {},
};
