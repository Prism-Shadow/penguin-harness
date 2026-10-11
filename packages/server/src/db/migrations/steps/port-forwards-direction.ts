import type { Migration } from "../migration.js";

export const portForwardsDirection: Migration = {
  name: "port-forwards-direction",
  // Repair of a mistake: port-forwards (then numbered 13)'s DDL was changed in place (a `direction` column,
  // uniqueness per direction) while a few data roots had already run its first form — a
  // recorded migration is never re-run, so those roots kept a `port_forwards` the platform
  // can no longer write to (every insert names `direction`) and answered 500. Migration 14
  // creates that same first form on the roots it adopts, so its tables arrive here too.
  // This brings such a table to the current shape, rows kept as `in` forwards; a root
  // whose table already has the column is left alone.
  //
  // Swap-safe although it rebuilds: the rebuilt table is a superset the predecessor still
  // writes to — `direction` defaults to 'in', which is the one direction the predecessor
  // knew — and reads from unchanged. A rollback loses nothing.
  swapSafe: true,
  up(db) {
    const cols = db.prepare("PRAGMA table_info(port_forwards)").all() as { name: string }[];
    if (cols.length === 0 || cols.some((c) => c.name === "direction")) return;
    db.exec(`
      CREATE TABLE port_forwards_v2 (
        id          TEXT PRIMARY KEY,
        machine_id  TEXT NOT NULL,
        workspace   TEXT NOT NULL,
        direction   TEXT NOT NULL DEFAULT 'in',
        remote_port INTEGER NOT NULL,
        local_port  INTEGER NOT NULL,
        created_at  TEXT NOT NULL,
        UNIQUE (machine_id, workspace, direction, remote_port)
      );
      INSERT INTO port_forwards_v2 (id, machine_id, workspace, direction, remote_port, local_port, created_at)
        SELECT id, machine_id, workspace, 'in', remote_port, local_port, created_at FROM port_forwards;
      DROP TABLE port_forwards;
      ALTER TABLE port_forwards_v2 RENAME TO port_forwards;
      CREATE INDEX IF NOT EXISTS idx_port_forwards_machine ON port_forwards(machine_id, workspace);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_port_forwards_local_in ON port_forwards(local_port) WHERE direction = 'in';
    `);
  },
  // Puts the first form back — and LOSES every `out` forward, which that form cannot hold.
  down(db) {
    const cols = db.prepare("PRAGMA table_info(port_forwards)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "direction")) return;
    db.exec(`
      CREATE TABLE port_forwards_v1 (
        id          TEXT PRIMARY KEY,
        machine_id  TEXT NOT NULL,
        workspace   TEXT NOT NULL,
        remote_port INTEGER NOT NULL,
        local_port  INTEGER NOT NULL UNIQUE,
        created_at  TEXT NOT NULL,
        UNIQUE (machine_id, workspace, remote_port)
      );
      INSERT INTO port_forwards_v1 (id, machine_id, workspace, remote_port, local_port, created_at)
        SELECT id, machine_id, workspace, remote_port, local_port, created_at FROM port_forwards WHERE direction = 'in';
      DROP TABLE port_forwards;
      ALTER TABLE port_forwards_v1 RENAME TO port_forwards;
      CREATE INDEX IF NOT EXISTS idx_port_forwards_machine ON port_forwards(machine_id, workspace);
    `);
  },
};
