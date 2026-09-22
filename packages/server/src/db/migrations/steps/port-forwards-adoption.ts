import type { Migration } from "../migration.js";

export const portForwardsAdoption: Migration = {
  name: "port-forwards-adoption",
  // A data root that ran the closed #797 line is stamped 13 under THAT line's numbering
  // (13 = company-mode-org-caches-adoption), so on this line's numbering port-forwards
  // (13) reads as already applied and only the migrations after it run. Such a root reaches
  // the latest version without `port_forwards`, and the port-forwards module's start —
  // which lists the table — throws at boot: the server exits before it listens. Seen on
  // every machine a server on the old line handed this build to.
  //
  // Re-runs migration 13's own `up` — the frozen DDL, all `IF NOT EXISTS`, so a root that
  // took it in its proper place finds its work done. The ledger ended the numbering hazard:
  // adopting a numbered root runs port-forwards itself. Remove together with the ledger's
  // adoption of numbered roots (index.ts).
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
