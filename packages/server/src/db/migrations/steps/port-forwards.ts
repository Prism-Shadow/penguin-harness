import type { Migration } from "../migration.js";

export const portForwards: Migration = {
  name: "port-forwards",
  // One new table, nothing existing touched: a platform rolled back to one without port
  // forwarding never queries it.
  swapSafe: true,
  up(db) {
    // Frozen copy of the DDL as of the port forwarding feature; do not re-derive from
    // schema.ts. IF NOT EXISTS because the declarative track may already have created it.
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
      CREATE UNIQUE INDEX IF NOT EXISTS idx_port_forwards_local_in ON port_forwards(local_port) WHERE direction = 'in';
    `);
  },
  // LOSES every saved forward: which port of which machine each Workspace brought here,
  // and the local port it was given.
  down(db) {
    db.exec(
      `DROP INDEX IF EXISTS idx_port_forwards_local_in; DROP INDEX IF EXISTS idx_port_forwards_machine; DROP TABLE IF EXISTS port_forwards;`,
    );
  },
};
