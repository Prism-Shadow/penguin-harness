/**
 * The ordered-migration mechanism, the 0.2.4 → 0.2.7 migration that is its first entry, the
 * 0.2.9 → 0.2.10 drop that is its first restart-only one, and the channels migration that is
 * its first table recreation.
 *
 * Two properties carry everything else: a real 0.2.4 database reaches exactly the shape a
 * fresh one is created with (so a runtime older than the platform pushed onto it becomes
 * usable), and the version stamp commits with the migration (so an interrupted run is never
 * half-applied). The swapPath suite pins the rule that keeps a hot push honest.
 */
import { describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import {
  IrreversibleMigrationError,
  LATEST_VERSION,
  MIGRATIONS,
  RestartRequiredError,
  migrate,
  rollbackTo,
  schemaVersion,
} from "../src/db/migrations.js";
import { SCHEMA_SQL } from "../src/db/schema.js";

const sqlite = process.getBuiltinModule("node:sqlite");

/**
 * The goal_state table as every release from 0.1.3 to 0.2.9 declared it (frozen: the live
 * schema no longer has it, and the migration that drops it must not learn a new shape).
 */
const GOAL_STATE_DDL = `
  CREATE TABLE goal_state (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL,
    project_id  TEXT NOT NULL,
    agent_id    TEXT NOT NULL,
    objective   TEXT NOT NULL,
    status      TEXT NOT NULL,
    budget      INTEGER NOT NULL,
    used        INTEGER NOT NULL DEFAULT 0,
    rounds      INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
  CREATE INDEX idx_goal_session ON goal_state(session_id);
`;

/**
 * The v0.2.4 schema, as a frozen excerpt: today's declaration minus exactly what 0.2.4
 * lacked, plus the one table it had that today's declaration dropped. Derived from
 * SCHEMA_SQL, not by hand-copying 15 tables that would fork from reality.
 */
/** The company-mode tables migration 4 adds: a database from before it never had them. */
function dropCompanyModeTables(db: DatabaseSync): void {
  for (const table of [
    "org_sessions",
    "org_ticket_sessions",
    "org_calendar_state",
    "org_ticket_state",
    "org_channel_state",
    "org_channel_reads",
    "org_budget_state",
  ]) {
    db.exec(`DROP TABLE IF EXISTS ${table}`);
  }
}

function open024(): DatabaseSync {
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec(SCHEMA_SQL);
  dropCompanyModeTables(db);
  db.exec("DROP TABLE messaging_bindings");
  db.exec("DROP INDEX IF EXISTS idx_auth_sessions_expires");
  db.exec("DROP INDEX IF EXISTS idx_auth_sessions_user");
  db.exec(GOAL_STATE_DDL);
  return db;
}

/**
 * The two chat tables as migration 4 declared them (frozen: company mode's chat became
 * channels in migration 5 — renamed tables, `channel_id` in the primary keys — and the
 * migration that recreates them must not learn a new shape).
 */
const PRE_CHANNEL_CHAT_DDL = `
  DROP TABLE IF EXISTS org_channel_state;
  DROP TABLE IF EXISTS org_channel_reads;
  CREATE TABLE org_chat_state (
    project_id   TEXT NOT NULL,
    org_id       TEXT NOT NULL,
    date         TEXT NOT NULL,
    offset_bytes INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (project_id, org_id, date)
  );
  CREATE TABLE org_chat_reads (
    project_id   TEXT NOT NULL,
    org_id       TEXT NOT NULL,
    user_id      TEXT NOT NULL,
    last_read_id TEXT NOT NULL,
    PRIMARY KEY (project_id, org_id, user_id)
  );
`;

/** A database stamped at migration 4: company mode's caches, before chat became channels. */
function open4(): DatabaseSync {
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec(SCHEMA_SQL);
  db.exec(PRE_CHANNEL_CHAT_DDL);
  db.exec("PRAGMA user_version = 4");
  return db;
}

/** A 0.2.9 database: everything 0.2.4 had plus what versions 1 and 2 added, and still goal_state. */
function open029(): DatabaseSync {
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec(SCHEMA_SQL);
  dropCompanyModeTables(db);
  db.exec(GOAL_STATE_DDL);
  db.exec("PRAGMA user_version = 2");
  return db;
}

/** Runs `fn` with the restart-only migration taken off the list, so a swap-path case can see swap-safe ones apply. */
function withoutRestartOnly<T>(fn: () => T): T {
  const list = MIGRATIONS as unknown as (typeof MIGRATIONS)[number][];
  const removed = list.splice(2, 1);
  try {
    return fn();
  } finally {
    // Back where it was: appending would reorder the list once later migrations exist.
    list.splice(2, 0, ...removed);
  }
}

/**
 * Every schema object, in a form two databases can be compared by — columns keyed by NAME,
 * with ordinal position (`cid`) excluded.
 *
 * Column ORDER is deliberately not compared. `ALTER TABLE ADD COLUMN` appends, while a
 * fresh database gets the column wherever SCHEMA_SQL declares it, so a migrated database
 * and a freshly created one hold the same columns in a different order — and always have:
 * openDatabase's own ensureColumn list has appended columns to released databases since
 * long before migrations existed. Making the orders match would mean rebuilding the table,
 * which is not additive and would take the rollback guarantee with it. What order actually
 * costs is the column order of `SELECT *`, and every read here maps rows by name.
 *
 * Index column order IS compared: for a composite index it is the index.
 */
function shape(db: DatabaseSync): string {
  const objs = db
    .prepare(
      "SELECT type, name, tbl_name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    )
    .all() as { type: string; name: string; tbl_name: string }[];
  const dropCid = (rows: unknown[]): Record<string, unknown>[] =>
    rows.map((r) => {
      const { cid: _cid, ...rest } = r as Record<string, unknown>;
      return rest;
    });
  return JSON.stringify(
    objs.map((o) => ({
      ...o,
      detail:
        o.type === "table"
          ? dropCid(db.prepare(`PRAGMA table_info(${o.name})`).all()).sort((a, b) =>
              String(a.name) < String(b.name) ? -1 : String(a.name) > String(b.name) ? 1 : 0,
            )
          : dropCid(db.prepare(`PRAGMA index_info(${o.name})`).all()),
      unique:
        o.type === "index"
          ? (
              db.prepare(`PRAGMA index_list(${o.tbl_name})`).all() as {
                name: string;
                unique: number;
              }[]
            ).find((i) => i.name === o.name)?.unique
          : undefined,
    })),
  );
}

describe("migration mechanism", () => {
  it("versions are contiguous from 1, so a stamp names an unambiguous state", () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual(MIGRATIONS.map((_, i) => i + 1));
    expect(LATEST_VERSION).toBe(MIGRATIONS.length);
  });

  it("stamps the database with how far it has come", () => {
    const db = open024();
    try {
      expect(schemaVersion(db)).toBe(0);
      const r = migrate(db);
      expect(r.from).toBe(0);
      expect(r.to).toBe(LATEST_VERSION);
      expect(r.applied).toEqual(MIGRATIONS.map((m) => m.name));
      expect(schemaVersion(db)).toBe(LATEST_VERSION);
    } finally {
      db.close();
    }
  });

  it("runs once: an already-current database does no work", () => {
    const db = open024();
    try {
      migrate(db);
      const before = shape(db);
      const again = migrate(db);
      expect(again.applied).toEqual([]);
      expect(again.from).toBe(LATEST_VERSION);
      expect(shape(db)).toBe(before);
    } finally {
      db.close();
    }
  });

  it("a failing migration leaves the version untouched, never half-applied", () => {
    const db = open024();
    try {
      const boom = {
        version: LATEST_VERSION + 1,
        name: "explodes",
        swapSafe: true,
        up(d: DatabaseSync) {
          d.exec("CREATE TABLE scratch_marker (x TEXT)");
          throw new Error("boom");
        },
      };
      migrate(db);
      const at = schemaVersion(db);
      const shapeBefore = shape(db);
      (MIGRATIONS as unknown as (typeof boom)[]).push(boom);
      try {
        expect(() => migrate(db)).toThrow(/explodes.*failed/s);
        expect(schemaVersion(db)).toBe(at);
        // The table its `up` created is gone with the rolled-back transaction.
        expect(shape(db)).toBe(shapeBefore);
      } finally {
        (MIGRATIONS as unknown as (typeof boom)[]).pop();
      }
    } finally {
      db.close();
    }
  });
});

describe("the swap path refuses what a rollback could not survive", () => {
  it("applies swap-safe migrations while a pushed platform boots", () => {
    const db = open024();
    try {
      const swapSafe = MIGRATIONS.filter((m) => m.swapSafe).map((m) => m.name);
      expect(withoutRestartOnly(() => migrate(db, { swapPath: true }).applied)).toEqual(swapSafe);
    } finally {
      db.close();
    }
  });

  it("refuses a restart-only migration whole, applying nothing — drop-goal-state is the first", () => {
    const db = open024();
    try {
      const before = shape(db);
      expect(() => migrate(db, { swapPath: true })).toThrow(RestartRequiredError);
      // Not even the swap-safe migrations ahead of it ran: the push is refused whole.
      expect(shape(db)).toBe(before);
      expect(schemaVersion(db)).toBe(0);
      // The runtime's own open, which owns the process, may apply it.
      expect(migrate(db).applied).toEqual(MIGRATIONS.map((m) => m.name));
    } finally {
      db.close();
    }
  });

  it("a database already at the latest version boots on the swap path without a word", () => {
    const db = open024();
    try {
      migrate(db);
      expect(migrate(db, { swapPath: true }).applied).toEqual([]);
    } finally {
      db.close();
    }
  });
});

describe("0.2.9 → current: drop-goal-state", () => {
  it("drops the table and its index, and a database that never had them migrates the same", () => {
    const db = open029();
    const fresh = new sqlite.DatabaseSync(":memory:");
    try {
      fresh.exec(SCHEMA_SQL);
      const after029 = MIGRATIONS.filter((m) => m.version > 2).map((m) => m.name);
      expect(migrate(db).applied).toEqual(after029);
      expect(shape(db)).toBe(shape(fresh));
      // IF EXISTS: a database this build created, stamped 2 by an older mechanism, has no
      // goal_state to drop and must not fail on it.
      fresh.exec("PRAGMA user_version = 2");
      expect(migrate(fresh).applied).toEqual(after029);
    } finally {
      db.close();
      fresh.close();
    }
  });

  it("down recreates the 0.2.9 table empty, with its index", () => {
    const db = open029();
    try {
      db.exec(
        "INSERT INTO goal_state (session_id, project_id, agent_id, objective, status, budget, created_at, updated_at)" +
          " VALUES ('s1', 'p1', 'a1', 'ship it', 'complete', -1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
      );
      const before = shape(db);
      migrate(db);
      rollbackTo(db, 2);
      expect(shape(db)).toBe(before);
      expect(db.prepare("SELECT COUNT(*) AS n FROM goal_state").get()).toEqual({ n: 0 });
    } finally {
      db.close();
    }
  });
});

describe("migration 4 → current: company-mode-channels", () => {
  it("renames both chat tables and puts channel_id in their primary keys, recreating them empty", () => {
    const db = open4();
    const fresh = new sqlite.DatabaseSync(":memory:");
    try {
      fresh.exec(SCHEMA_SQL);
      db.exec(
        "INSERT INTO org_chat_reads (project_id, org_id, user_id, last_read_id)" +
          " VALUES ('p1', 'acme', 'alice', 'msg-2026-09-01-00-00-00-00000000')",
      );
      expect(shape(db)).not.toBe(shape(fresh));

      expect(migrate(db).applied).toEqual(
        MIGRATIONS.filter((m) => m.version > 4).map((m) => m.name),
      );
      expect(shape(db)).toBe(shape(fresh));
      // Renamed and recreated, not altered: the old tables are gone, nothing is carried
      // over, and a row now names its channel.
      expect(
        db
          .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'org_chat_reads'")
          .get(),
      ).toBeUndefined();
      expect(db.prepare("SELECT COUNT(*) AS n FROM org_channel_reads").get()).toEqual({ n: 0 });
      db.exec(
        "INSERT INTO org_channel_reads (project_id, org_id, channel_id, user_id, last_read_id)" +
          " VALUES ('p1', 'acme', 'default_channel', 'alice', 'msg-2026-09-01-00-00-00-00000000')",
      );
      expect(db.prepare("SELECT channel_id FROM org_channel_reads").all()).toEqual([
        { channel_id: "default_channel" },
      ]);
    } finally {
      db.close();
      fresh.close();
    }
  });

  it("down puts the old tables and the single-chat shape back, empty", () => {
    const db = open4();
    const at4 = open4();
    try {
      migrate(db);
      rollbackTo(db, 4);
      expect(schemaVersion(db)).toBe(4);
      expect(shape(db)).toBe(shape(at4));
      expect(db.prepare("SELECT COUNT(*) AS n FROM org_chat_state").get()).toEqual({ n: 0 });
    } finally {
      db.close();
      at4.close();
    }
  });
});

describe("0.2.4 → current", () => {
  /** The whole point: an older runtime's database becomes what a current build creates. */
  it("brings a 0.2.4 database to the shape a fresh one is created with", () => {
    const old = open024();
    const fresh = new sqlite.DatabaseSync(":memory:");
    try {
      fresh.exec(SCHEMA_SQL);
      expect(shape(old)).not.toBe(shape(fresh));

      migrate(old);

      expect(shape(old)).toBe(shape(fresh));
    } finally {
      old.close();
      fresh.close();
    }
  });

  it("the messaging table it creates is writable, which is what the boot needed", () => {
    const db = open024();
    try {
      migrate(db);
      db.exec(
        "INSERT INTO messaging_bindings (session_id, channel, account_id, config_json, created_at, updated_at)" +
          " VALUES ('s1', 'telegram', 'a1', '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
      );
      expect(db.prepare("SELECT COUNT(*) AS n FROM messaging_bindings").get()).toEqual({ n: 1 });
    } finally {
      db.close();
    }
  });

  it("leaves existing rows alone", () => {
    const db = open024();
    try {
      db.exec(
        "INSERT INTO users (user_id, password_hash, is_admin, created_at) VALUES ('admin', 'h', 1, '2026-01-01T00:00:00Z')",
      );
      migrate(db);
      expect(db.prepare("SELECT user_id FROM users").all()).toEqual([{ user_id: "admin" }]);
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

  it("undoes a migration and moves the stamp back with it", () => {
    const db = open024();
    try {
      migrate(db);
      expect(schemaVersion(db)).toBe(LATEST_VERSION);

      // Back to version 1: everything after it is undone, so the columns migration 2 added are gone.
      const r = rollbackTo(db, 1);
      expect(r.from).toBe(LATEST_VERSION);
      expect(r.to).toBe(1);
      expect(r.reverted).toEqual(
        MIGRATIONS.filter((m) => m.version > 1)
          .map((m) => m.name)
          .reverse(),
      );
      const cols = (
        db.prepare("PRAGMA table_info(messaging_bindings)").all() as { name: string }[]
      ).map((c) => c.name);
      expect(cols).not.toContain("render_markdown");
      expect(cols).not.toContain("final_reply_only");
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

      rollbackTo(db, 0);
      expect(schemaVersion(db)).toBe(0);
      expect(shape(db)).not.toBe(afterUp);

      migrate(db);
      expect(schemaVersion(db)).toBe(LATEST_VERSION);
      expect(shape(db)).toBe(afterUp);
    } finally {
      db.close();
    }
  });

  it("reverts newest first, so a multi-step rollback is ordered", () => {
    const db = open024();
    try {
      migrate(db);
      const r = rollbackTo(db, 0);
      expect(r.reverted).toEqual(
        MIGRATIONS.filter((m) => m.version > 0)
          .map((m) => m.name)
          .reverse(),
      );
      expect(
        db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'messaging_bindings'",
          )
          .get(),
      ).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("refuses whole when anything in range has no down, applying nothing", () => {
    const db = open024();
    try {
      migrate(db);
      const at = schemaVersion(db);
      const before = shape(db);
      const oneWay = {
        version: LATEST_VERSION + 1,
        name: "one-way",
        swapSafe: true,
        up(d: DatabaseSync) {
          d.exec("CREATE TABLE one_way (x TEXT)");
        },
        down: null,
      };
      (MIGRATIONS as unknown as (typeof oneWay)[]).push(oneWay);
      try {
        migrate(db);
        // Rolling back past the irreversible one is refused before anything is undone —
        // including the reversible migrations sitting above it.
        expect(() => rollbackTo(db, 0)).toThrow(IrreversibleMigrationError);
        expect(schemaVersion(db)).toBe(at + 1);
      } finally {
        (MIGRATIONS as unknown as (typeof oneWay)[]).pop();
        // Leave the fixture database as the other cases expect it.
        db.exec("DROP TABLE IF EXISTS one_way");
        db.exec(`PRAGMA user_version = ${at}`);
        expect(shape(db)).toBe(before);
      }
    } finally {
      db.close();
    }
  });

  it("will not roll forward, and rejects a negative target", () => {
    const db = open024();
    try {
      migrate(db);
      expect(() => rollbackTo(db, LATEST_VERSION + 5)).toThrow(/already below/);
      expect(() => rollbackTo(db, -1)).toThrow(/negative/);
    } finally {
      db.close();
    }
  });
});
