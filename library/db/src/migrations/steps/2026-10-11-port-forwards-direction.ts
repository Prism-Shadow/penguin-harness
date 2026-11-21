import type { Migration } from "../migration.js";
import { portForwards } from "./2026-10-11-port-forwards.js";

export const portForwardsDirection: Migration = {
  name: "2026-10-11-port-forwards-direction",
  // Repair of a mistake: the first deployed form of `port_forwards` had no `direction` column,
  // and its DDL was widened in place afterwards — a recorded migration is never re-run, so a
  // root that ran the first form kept a table the platform can no longer write to (every
  // insert names `direction`) and answered 500. The adoption above creates that same first
  // form on the roots it adopts, so its tables arrive here too. This brings such a table to
  // the current shape, rows kept as `in` forwards; a root whose table already has the column
  // is left alone.
  //
  // Swap-safe although it rebuilds: the rebuilt table is a superset the predecessor still
  // writes to — `direction` defaults to 'in', which is the one direction the predecessor
  // knew — and reads from unchanged. A rollback loses nothing.
  swapSafe: true,
  up(db) {
    const cols = db.prepare("PRAGMA table_info(port_forwards)").all() as { name: string }[];
    if (cols.length === 0) {
      // The ledger says this root has the table, the file says otherwise (dropped by hand, or
      // carried across machines and lines): stand the current shape back up. Re-running the
      // base step keeps its DDL in one place.
      portForwards.up(db);
      return;
    }
    if (cols.some((c) => c.name === "direction")) {
      // Already the current shape — but the uniqueness index is created by the base step only
      // when it sees the column, and that step may have run before a first-form table existed
      // here. IF NOT EXISTS makes this the repair for a column without its index, at no cost
      // when the index is already there.
      db.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_port_forwards_local_in ON port_forwards(local_port) WHERE direction = 'in';`,
      );
      return;
    }
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
