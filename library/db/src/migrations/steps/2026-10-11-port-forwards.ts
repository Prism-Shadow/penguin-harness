import type { Migration } from "../migration.js";

export const portForwards: Migration = {
  name: "2026-10-11-port-forwards",
  // One new table, nothing existing touched: a build without port forwarding never queries it.
  // Frozen copy of the DDL as of the port forwarding feature; do not re-derive from schema.ts.
  // IF NOT EXISTS because the declarative track may already have created it.
  swapSafe: true,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS port_forwards (
        id          TEXT PRIMARY KEY,
        machine_id  TEXT NOT NULL,
        workspace   TEXT NOT NULL,
        direction   TEXT NOT NULL,
        remote_port INTEGER NOT NULL,
        local_port  INTEGER NOT NULL,
        created_at  TEXT NOT NULL,
        UNIQUE (machine_id, workspace, direction, remote_port)
      );
      CREATE INDEX IF NOT EXISTS idx_port_forwards_machine ON port_forwards(machine_id, workspace);
    `);
    // The uniqueness index names the `direction` column, so it can only be built over a table
    // that already has it. A database that traveled from a line running the first form arrives
    // here with a table lacking the column and (often) no ledger of its own — creating the
    // index now would fail, and the repair below would never run. That step rebuilds the table
    // and builds both indexes; on a table already in the current shape they are IF NOT EXISTS
    // and this step's skip of the uniqueness index costs nothing.
    const cols = db.prepare("PRAGMA table_info(port_forwards)").all() as { name: string }[];
    if (cols.some((c) => c.name === "direction")) {
      db.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_port_forwards_local_in ON port_forwards(local_port) WHERE direction = 'in';`,
      );
    }
  },
  // LOSES every saved forward: which port of which machine each Workspace brought here,
  // and the local port it was given.
  down(db) {
    db.exec(
      `DROP INDEX IF EXISTS idx_port_forwards_local_in; DROP INDEX IF EXISTS idx_port_forwards_machine; DROP TABLE IF EXISTS port_forwards;`,
    );
  },
};
