/**
 * The migration ledger: which migrations run, in what order, what is recorded, and what an
 * older build, another PR line, a hot push and an operator's rollback each see. What every
 * single migration changes is pinned in db-migration-steps.test.ts.
 *
 * Three properties carry everything else: a database with no ledger — a 0.2.4 one, a root
 * stamped by any line's numbering, a new one — reaches exactly the shape a fresh one is
 * created with; every migration is re-runnable, which is what makes that adoption safe; and
 * a migration commits with its ledger row, so an interrupted run is never half-applied.
 */
import { describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import {
  IrreversibleMigrationError,
  MIGRATIONS,
  type Migration,
  UnknownMigrationError,
  appliedMigrations,
  migrate,
  rollbackTo,
} from "../src/db/migrations/index.js";
import * as runner from "../src/db/migrations/runner.js";
import {
  columns,
  contents,
  hasTable,
  namesAfter,
  namesThrough,
  open024,
  openFresh,
  record,
  shape,
  sqlite,
  stampThrough,
} from "./db-migrations-fixtures.js";
import { SCHEMA_SQL } from "../src/db/schema.js";

const userVersion = (db: DatabaseSync): number =>
  (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;

/** A current database with a row in the tables a re-run could plausibly disturb. */
function openWithRows(): DatabaseSync {
  const db = openFresh();
  migrate(db);
  db.exec(`
    INSERT INTO users (user_id, password_hash, is_admin, created_at, display_name)
      VALUES ('owner', 'h', 1, '2026-09-20T00:00:00.000Z', 'Owner');
    INSERT INTO projects (project_id, owner_user_id, created_at)
      VALUES ('p1', 'owner', '2026-09-20T00:00:00.000Z');
    INSERT INTO model_promotions (project_id, provider, model_id, discount, updated_at)
      VALUES ('p1', 'tokendance', 'm1', 0.5, '2026-09-20T00:00:00.000Z');
    INSERT INTO messaging_bindings (session_id, channel, account_id, config_json, created_at, updated_at, render_markdown)
      VALUES ('s1', 'telegram', 'a1', '{}', '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z', 0);
    INSERT INTO org_channel_reads (project_id, org_id, channel_id, user_id, last_read_id)
      VALUES ('p1', 'acme', 'default_channel', 'owner', 'msg-1');
    INSERT INTO machines (address, machine_id, session_pid, platform)
      VALUES ('ssh:nas', 'm1', 42, 'linux');
    INSERT INTO browser_extensions (extension_id, user_id, token_hash, name, version, created_at)
      VALUES ('e1', 'owner', 'h1', 'Chrome 130 on Linux', '0.2.13', '2026-09-20T00:00:00.000Z');
  `);
  return db;
}

describe("the ledger", () => {
  it("adopts a database without one: every migration runs once and is recorded in order", () => {
    const db = open024();
    const fresh = openFresh();
    try {
      const r = migrate(db);
      expect(r.adopted).toBe(true);
      expect(r.applied).toEqual(namesAfter(null));
      expect(appliedMigrations(db)).toEqual(namesAfter(null));
      expect(shape(db)).toBe(shape(fresh));
    } finally {
      db.close();
      fresh.close();
    }
  });

  it("runs once: an already-current database does no work and writes nothing", () => {
    const db = openWithRows();
    try {
      const before = { shape: shape(db), contents: contents(db), ledger: appliedMigrations(db) };
      const again = migrate(db);
      expect(again).toEqual({ adopted: false, applied: [], deferred: [] });
      expect({ shape: shape(db), contents: contents(db), ledger: appliedMigrations(db) }).toEqual(
        before,
      );
    } finally {
      db.close();
    }
  });

  it("neither reads nor writes user_version: a numbered stamp is ignored and left as it was", () => {
    const db = openFresh();
    try {
      // Stamped past every migration by some line's numbering: the ledger still runs them all.
      db.exec("PRAGMA user_version = 17");
      expect(migrate(db).applied).toEqual(namesAfter(null));
      expect(userVersion(db)).toBe(17);
    } finally {
      db.close();
    }
    const created = openFresh();
    try {
      migrate(created);
      expect(userVersion(created)).toBe(0);
    } finally {
      created.close();
    }
  });

  it("a failing migration is left out of the ledger, never half-applied", () => {
    const db = openFresh();
    try {
      migrate(db);
      const boom: Migration = {
        name: "explodes",
        swapSafe: true,
        up(d) {
          d.exec("CREATE TABLE scratch_marker (x TEXT)");
          throw new Error("boom");
        },
        down: null,
      };
      const before = shape(db);
      expect(() => runner.migrate(db, [...MIGRATIONS, boom])).toThrow(/explodes.*failed/s);
      expect(appliedMigrations(db)).toEqual(namesAfter(null));
      // The table its `up` created is gone with the rolled-back transaction.
      expect(shape(db)).toBe(before);
    } finally {
      db.close();
    }
  });

  it("an older build ignores the names a newer build recorded", () => {
    const db = openFresh();
    try {
      record(db, [...namesAfter(null), "from-a-newer-build"]);
      expect(migrate(db)).toEqual({ adopted: false, applied: [], deferred: [] });
      expect(appliedMigrations(db)).toContain("from-a-newer-build");
    } finally {
      db.close();
    }
  });

  it("applies a migration another line's build skipped, when the root meets it", () => {
    const db = openFresh();
    try {
      // A root whose builds never declared model-promotions, though they declared what follows it.
      db.exec("DROP TABLE model_promotions");
      record(
        db,
        namesAfter(null).filter((n) => n !== "model-promotions"),
      );
      expect(migrate(db).applied).toEqual(["model-promotions"]);
      expect(hasTable(db, "model_promotions")).toBe(true);
      // Recorded where it actually ran: last.
      expect(appliedMigrations(db).at(-1)).toBe("model-promotions");
    } finally {
      db.close();
    }
  });

  it("an adoption cut short resumes from where it stopped", () => {
    const db = open024();
    const fresh = openFresh();
    try {
      const boom: Migration = {
        name: "stops-here",
        swapSafe: true,
        up() {
          throw new Error("power cut");
        },
        down: null,
      };
      const half = namesThrough("user-profile").length;
      const cut = [...MIGRATIONS.slice(0, half), boom, ...MIGRATIONS.slice(half)];
      expect(() => runner.migrate(db, cut)).toThrow(/stops-here/);
      expect(appliedMigrations(db)).toEqual(namesThrough("user-profile"));
      expect(migrate(db)).toEqual({
        adopted: false,
        applied: namesAfter("user-profile"),
        deferred: [],
      });
      expect(shape(db)).toBe(shape(fresh));
    } finally {
      db.close();
      fresh.close();
    }
  });
});

describe("every migration is re-runnable", () => {
  it("running any migration's `up` again changes neither the shape nor a single row", () => {
    const db = openWithRows();
    try {
      const before = { shape: shape(db), contents: contents(db) };
      for (const m of MIGRATIONS) {
        m.up(db);
        expect({ shape: shape(db), contents: contents(db) }, m.name).toEqual(before);
      }
    } finally {
      db.close();
    }
  });

  it("adopting a current root from the numbered era records every name and changes nothing else", () => {
    const db = openWithRows();
    try {
      db.exec("DROP TABLE schema_migrations");
      db.exec("PRAGMA user_version = 17");
      const before = { shape: shape(db), contents: contents(db) };
      const r = migrate(db);
      expect(r.adopted).toBe(true);
      expect(appliedMigrations(db)).toEqual(namesAfter(null));
      expect({ shape: shape(db), contents: contents(db) }).toEqual(before);
    } finally {
      db.close();
    }
  });
});

describe("the swap path applies every expand migration and leaves contracts pending", () => {
  it("adopts a numbered root while a pushed platform boots, leaving drop-goal-state for the runtime", () => {
    const db = openFresh();
    const fresh = openFresh();
    try {
      // Every numbered root a build since 0.2.10 opened: no goal_state, a stamp, no ledger —
      // here the one the chain stamped 16 before its restack, without main's two model tables.
      db.exec(
        "DROP TABLE model_promotions; DROP TABLE model_provider_auth_tokens; PRAGMA user_version = 16;",
      );
      const r = migrate(db, { swapPath: true });
      expect(r.adopted).toBe(true);
      expect(r.applied).toEqual(namesAfter(null).filter((n) => n !== "drop-goal-state"));
      expect(r.deferred).toEqual(["drop-goal-state"]);
      expect(shape(db)).toBe(shape(fresh));
      // The runtime's next open records it, as the no-op it is here.
      expect(migrate(db)).toEqual({ adopted: false, applied: ["drop-goal-state"], deferred: [] });
    } finally {
      db.close();
      fresh.close();
    }
  });

  it("boots on a root whose goal_state is still there, keeping it — a contract never runs on the swap path", () => {
    const db = open024();
    try {
      const r = migrate(db, { swapPath: true });
      expect(r.deferred).toEqual(["drop-goal-state"]);
      expect(r.applied).toEqual(namesAfter(null).filter((n) => n !== "drop-goal-state"));
      expect(hasTable(db, "goal_state")).toBe(true);
      // A second push leaves it pending again, and still boots.
      expect(migrate(db, { swapPath: true })).toEqual({
        adopted: false,
        applied: [],
        deferred: ["drop-goal-state"],
      });
      // The runtime's own open, which owns the process, applies it.
      expect(migrate(db).applied).toEqual(["drop-goal-state"]);
      expect(hasTable(db, "goal_state")).toBe(false);
    } finally {
      db.close();
    }
  });

  it("a current database boots on the swap path without a word", () => {
    const db = openFresh();
    try {
      migrate(db);
      expect(migrate(db, { swapPath: true }).applied).toEqual([]);
    } finally {
      db.close();
    }
  });

  /**
   * The session row's `surface` column reaches a LIVE deployment only this way. Its line in
   * openDatabase's ensureColumn list runs when the process starts, and a push never restarts
   * the runtime — so without the migration a pushed platform writes `surface` to a table
   * that has no such column, and every session insert fails: creation, fork, subagent
   * registration, and the Trace adoption the session list hydrates through.
   */
  it("grows the session surface column on the swap path, so a pushed platform can write sessions", () => {
    const db = openFresh();
    try {
      // A database as a running runtime holds it: migrated through the migration before this
      // column, and with the column itself absent — which is what a push finds.
      db.exec("ALTER TABLE sessions DROP COLUMN surface");
      stampThrough(db, "machines-columns");
      const insert = () =>
        db
          .prepare(
            `INSERT INTO sessions (session_id, project_id, agent_id, provider, model_id,
               workspace, approval_mode, title, client, has_trace, last_active_at, created_at, surface)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run("s1", "p", "a", "prov", "m", "/w", "allow-all", null, "web", 0, "t", "t", null);
      expect(insert).toThrow(/no column named surface/);

      migrate(db, { swapPath: true });
      expect(insert).not.toThrow();
      expect(
        (
          db.prepare("SELECT surface FROM sessions WHERE session_id = 's1'").get() as {
            surface: string | null;
          }
        ).surface,
      ).toBeNull();
    } finally {
      db.close();
    }
  });
});

describe("a root stamped by the closed #797 line: port-forwards-adoption", () => {
  it("brings back port_forwards on the swap path, and a root that has it migrates the same", () => {
    const db = new sqlite.DatabaseSync(":memory:");
    try {
      db.exec(SCHEMA_SQL);
      // Exactly the broken root: every table but port_forwards, with port-forwards recorded
      // as applied — what a hand-over of this build onto a root stamped past it under the
      // other line's numbering left behind.
      db.exec("DROP INDEX IF EXISTS idx_port_forwards_local_in; DROP TABLE port_forwards;");
      stampThrough(db, "port-forwards");
      const list = () => db.prepare("SELECT * FROM port_forwards").all();
      expect(list).toThrow(/no such table/);

      migrate(db, { swapPath: true });
      expect(list()).toEqual([]);
      expect(appliedMigrations(db)).toEqual(MIGRATIONS.map((m) => m.name));

      // A root that took port-forwards in its proper place: the adoption finds its work
      // done and changes nothing.
      const fresh = new sqlite.DatabaseSync(":memory:");
      try {
        fresh.exec(SCHEMA_SQL);
        stampThrough(fresh, "port-forwards");
        const before = shape(fresh);
        migrate(fresh, { swapPath: true });
        expect(shape(fresh)).toBe(before);
        expect(fresh.prepare("SELECT * FROM port_forwards").all()).toEqual([]);
      } finally {
        fresh.close();
      }
    } finally {
      db.close();
    }
  });
});

/**
 * The first form of `port_forwards`: what port-forwards created on the roots that ran it
 * before its DDL was changed in place, and what port-forwards-adoption still creates on the
 * roots it adopts — no direction, one local port per forward.
 */
const PORT_FORWARDS_V1_DDL = `
  CREATE TABLE port_forwards (
    id          TEXT PRIMARY KEY,
    machine_id  TEXT NOT NULL,
    workspace   TEXT NOT NULL,
    remote_port INTEGER NOT NULL,
    local_port  INTEGER NOT NULL UNIQUE,
    created_at  TEXT NOT NULL,
    UNIQUE (machine_id, workspace, remote_port)
  );
  CREATE INDEX IF NOT EXISTS idx_port_forwards_machine ON port_forwards(machine_id, workspace);
`;

describe("the first form of port_forwards → current: port-forwards-direction", () => {
  /** A root that ran port-forwards in its first form and has a forward saved, recorded through the adoption. */
  function openFirstForm(): DatabaseSync {
    const db = new sqlite.DatabaseSync(":memory:");
    db.exec(SCHEMA_SQL);
    db.exec("DROP INDEX IF EXISTS idx_port_forwards_local_in; DROP TABLE port_forwards;");
    db.exec(PORT_FORWARDS_V1_DDL);
    db.prepare(
      "INSERT INTO port_forwards (id, machine_id, workspace, remote_port, local_port, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("f1", "m1", "/home/dev/site", 3000, 3000, "2026-09-21T00:00:00.000Z");
    stampThrough(db, "port-forwards-adoption");
    return db;
  }
  const columns = (db: DatabaseSync): string[] =>
    (db.prepare("PRAGMA table_info(port_forwards)").all() as { name: string }[]).map((c) => c.name);
  const insertNew = (
    db: DatabaseSync,
    id: string,
    ws: string,
    dir: string,
    rp: number,
    lp: number,
  ) =>
    db
      .prepare(
        "INSERT INTO port_forwards (id, machine_id, workspace, direction, remote_port, local_port, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, "m1", ws, dir, rp, lp, "2026-09-21T00:00:00.000Z");
  const insertOld = (db: DatabaseSync, id: string, ws: string, rp: number, lp: number) =>
    db
      .prepare(
        "INSERT INTO port_forwards (id, machine_id, workspace, remote_port, local_port, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(id, "m1", ws, rp, lp, "2026-09-21T00:00:00.000Z");

  it("gives the table its direction on the swap path, keeps the forward as `in`, and takes an `out` sharing its port", () => {
    const db = openFirstForm();
    try {
      migrate(db, { swapPath: true });
      expect(columns(db)).toContain("direction");
      expect(db.prepare("SELECT id, direction, local_port FROM port_forwards").all()).toEqual([
        { id: "f1", direction: "in", local_port: 3000 },
      ]);
      // What the platform writes now…
      insertNew(db, "f2", "/home/dev/site", "out", 5432, 3000);
      // …and what a predecessor rolled back to would still write: no direction named.
      insertOld(db, "f3", "/home/dev/other", 8080, 8080);
      expect(db.prepare("SELECT direction FROM port_forwards WHERE id = 'f3'").get()).toEqual({
        direction: "in",
      });
      // Two `in` forwards still cannot share a local port.
      expect(() => insertOld(db, "f4", "/home/dev/third", 9000, 3000)).toThrow(/UNIQUE/);
    } finally {
      db.close();
    }
  });

  it("brings a table the adoption created — the same first form — to the current shape too", () => {
    const db = new sqlite.DatabaseSync(":memory:");
    try {
      db.exec(SCHEMA_SQL);
      db.exec("DROP INDEX IF EXISTS idx_port_forwards_local_in; DROP TABLE port_forwards;");
      stampThrough(db, "port-forwards");
      migrate(db, { swapPath: true });
      expect(columns(db)).toContain("direction");
      insertNew(db, "f1", "/home/dev/site", "out", 5432, 5432);
    } finally {
      db.close();
    }
  });

  it("leaves a table that already has the column alone", () => {
    const db = new sqlite.DatabaseSync(":memory:");
    try {
      db.exec(SCHEMA_SQL);
      stampThrough(db, "port-forwards-adoption");
      const before = shape(db);
      migrate(db);
      expect(shape(db)).toBe(before);
    } finally {
      db.close();
    }
  });

  it("down puts the first form back, without the `out` forwards it cannot hold", () => {
    const db = openFirstForm();
    try {
      migrate(db);
      insertNew(db, "f2", "/home/dev/site", "out", 5432, 3000);
      rollbackTo(db, "port-forwards-adoption");
      expect(columns(db)).not.toContain("direction");
      expect(db.prepare("SELECT id FROM port_forwards").all()).toEqual([{ id: "f1" }]);
    } finally {
      db.close();
    }
  });
});

describe("rollbackTo", () => {
  /** Every migration states an undo or states that it has none — never leaves it unsaid. */
  it("every migration declares its down, one way or the other", () => {
    for (const m of MIGRATIONS) {
      expect(m, `${m.name} must declare down (a function or null)`).toHaveProperty("down");
      expect(typeof m.down === "function" || m.down === null).toBe(true);
    }
  });

  it("names are unique: a name is the identity the ledger records", () => {
    const names = MIGRATIONS.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("undoes what was applied after the target, newest first, and forgets it in the ledger", () => {
    const db = open024();
    try {
      migrate(db);
      const r = rollbackTo(db, "messaging-bindings");
      expect(r.reverted).toEqual(namesAfter("messaging-bindings").reverse());
      expect(appliedMigrations(db)).toEqual(["messaging-bindings"]);
      const cols = columns(db, "messaging_bindings");
      expect(cols).not.toContain("render_markdown");
      expect(cols).not.toContain("final_reply_only");
      expect(hasTable(db, "machines")).toBe(false);
      expect(hasTable(db, "org_channel_reads")).toBe(false);
      // goal_state, which drop-goal-state dropped, is back.
      expect(hasTable(db, "goal_state")).toBe(true);
    } finally {
      db.close();
    }
  });

  it("follows the order migrations were APPLIED in, not the order they are declared in", () => {
    const db = openFresh();
    try {
      db.exec("DROP TABLE model_promotions");
      record(
        db,
        namesAfter(null).filter((n) => n !== "model-promotions"),
      );
      migrate(db);
      // model-promotions ran last, so it is the only one applied after the last other name.
      const lastOther = namesAfter(null)
        .filter((n) => n !== "model-promotions")
        .at(-1)!;
      expect(rollbackTo(db, lastOther).reverted).toEqual(["model-promotions"]);
      expect(hasTable(db, "model_promotions")).toBe(false);
    } finally {
      db.close();
    }
  });

  /** The property that makes an undo an undo: up ∘ down ∘ up leaves the same schema as up. */
  it("round-trips: up, down, up again lands on the same shape", () => {
    const db = open024();
    try {
      migrate(db);
      const afterUp = shape(db);
      rollbackTo(db, null);
      expect(appliedMigrations(db)).toEqual([]);
      expect(shape(db)).not.toBe(afterUp);
      expect(hasTable(db, "messaging_bindings")).toBe(false);
      expect(migrate(db)).toEqual({ adopted: false, applied: namesAfter(null), deferred: [] });
      expect(shape(db)).toBe(afterUp);
    } finally {
      db.close();
    }
  });

  it("refuses whole when anything in range has no down, undoing nothing", () => {
    const db = openFresh();
    try {
      const oneWay: Migration = {
        name: "one-way",
        swapSafe: true,
        up(d) {
          d.exec("CREATE TABLE IF NOT EXISTS one_way (x TEXT)");
        },
        down: null,
      };
      const list = [...MIGRATIONS, oneWay];
      runner.migrate(db, list);
      const before = shape(db);
      expect(() => runner.rollbackTo(db, list, null)).toThrow(IrreversibleMigrationError);
      expect(appliedMigrations(db)).toEqual(list.map((m) => m.name));
      expect(shape(db)).toBe(before);
    } finally {
      db.close();
    }
  });

  it("refuses whole when a name in range is not one this build declares", () => {
    const db = openFresh();
    try {
      record(db, [...namesAfter(null), "from-a-newer-build"]);
      const before = shape(db);
      expect(() => rollbackTo(db, null)).toThrow(UnknownMigrationError);
      expect(shape(db)).toBe(before);
      // Below the unknown name, it is out of range and nothing stands in the way.
      expect(rollbackTo(db, "from-a-newer-build").reverted).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("rejects a target that was never applied", () => {
    const db = new sqlite.DatabaseSync(":memory:");
    try {
      expect(() => rollbackTo(db, "machines")).toThrow(/not applied/);
    } finally {
      db.close();
    }
  });
});
