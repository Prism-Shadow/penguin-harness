/**
 * The ordered-migration mechanism, the 0.2.4 → 0.2.7 migration that is its first entry, the
 * 0.2.9 → 0.2.10 drop that is its first restart-only one, the additive column pair that
 * the user profile added to `users`, and the channels migration that is its first table
 * recreation.
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

/** Every company-mode table the migrations add: a database from before them had none. */
function dropCompanyModeTables(db: DatabaseSync): void {
  for (const table of [
    "org_sessions",
    "org_ticket_sessions",
    "org_calendar_state",
    "org_ticket_state",
    "org_channel_state",
    "org_channel_reads",
    "org_budget_state",
    "org_desk_notices",
  ]) {
    db.exec(`DROP TABLE IF EXISTS ${table}`);
  }
}

/**
 * Takes the port-forwards table off a database built from the current declaration. Every
 * fixture standing for a database OLDER than port forwarding needs it: a round trip that
 * rolls back through 13 drops the table, and would otherwise land on less than it began with.
 */
function dropPortForwards(db: DatabaseSync): void {
  db.exec(
    "DROP INDEX IF EXISTS idx_port_forwards_local_in; DROP INDEX IF EXISTS idx_port_forwards_machine; DROP TABLE IF EXISTS port_forwards;",
  );
  // And the Browser's own table, which every database older than that is older than too.
  db.exec("DROP TABLE IF EXISTS browser_sites;");
}

/**
 * The v0.2.4 schema, as a frozen excerpt: today's declaration minus exactly what 0.2.4
 * lacked, plus the one table it had that today's declaration dropped. Derived from
 * SCHEMA_SQL, not by hand-copying 15 tables that would fork from reality.
 */
function open024(): DatabaseSync {
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec(SCHEMA_SQL);
  db.exec("DROP TABLE IF EXISTS model_provider_auth_tokens");
  db.exec("DROP TABLE IF EXISTS model_promotions");
  dropPortForwards(db);
  dropCompanyModeTables(db);
  db.exec("DROP TABLE messaging_bindings");
  db.exec("DROP INDEX IF EXISTS idx_auth_sessions_expires");
  db.exec("DROP INDEX IF EXISTS idx_auth_sessions_user");
  // No account had a profile before migration 5: the current declaration's two columns
  // must come off, or a round trip through migration 5's down would land on a narrower
  // `users` than this fixture and read as a rollback that lost something.
  dropProfileColumns(db);
  db.exec(GOAL_STATE_DDL);
  return db;
}

/**
 * The two chat tables as migration 5 declared them (frozen: company mode's chat became
 * channels in migration 6 — renamed tables, `channel_id` in the primary keys — and the
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

/** A database stamped at migration 5: company mode's caches, before chat became channels. */
function open6(): DatabaseSync {
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec(SCHEMA_SQL);
  db.exec("DROP TABLE IF EXISTS model_provider_auth_tokens");
  db.exec("DROP TABLE IF EXISTS model_promotions");
  dropPortForwards(db);
  db.exec(PRE_CHANNEL_CHAT_DDL);
  // SCHEMA_SQL declares the CURRENT shape; migration 8's queue came after 6.
  db.exec("DROP TABLE IF EXISTS org_desk_notices");
  db.exec("PRAGMA user_version = 6");
  return db;
}

/** A database stamped at migration 6: channels, and no desk-notice queue yet. */
function open7(): DatabaseSync {
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec(SCHEMA_SQL);
  dropPortForwards(db);
  db.exec("DROP TABLE IF EXISTS org_desk_notices");
  db.exec("DROP TABLE IF EXISTS model_provider_auth_tokens");
  db.exec("DROP TABLE IF EXISTS model_promotions");
  db.exec("PRAGMA user_version = 7");
  return db;
}

/** A database stamped at migration 8: desk notices exist, but the promotions table does not. */
function open8(): DatabaseSync {
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec(SCHEMA_SQL);
  db.exec("DROP TABLE IF EXISTS model_provider_auth_tokens");
  db.exec("DROP TABLE IF EXISTS model_promotions");
  db.exec("PRAGMA user_version = 8");
  return db;
}

/** A database stamped at migration 9: promotions exist, but provider auth refresh tokens do not. */
function open9(): DatabaseSync {
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec(SCHEMA_SQL);
  db.exec("DROP TABLE IF EXISTS model_provider_auth_tokens");
  db.exec("PRAGMA user_version = 9");
  return db;
}

/** A 0.2.9 database: everything 0.2.4 had plus what versions 1 and 2 added, and still goal_state. */
function open029(): DatabaseSync {
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec(SCHEMA_SQL);
  db.exec("DROP TABLE IF EXISTS model_provider_auth_tokens");
  db.exec("DROP TABLE IF EXISTS model_promotions");
  dropPortForwards(db);
  dropCompanyModeTables(db);
  db.exec(GOAL_STATE_DDL);
  // SCHEMA_SQL declares the CURRENT shape, and a 0.2.9 database has no machines tables —
  // migration 4 is what adds them — and no profile columns, which migration 5 adds. Without
  // both the fixture is a database no release made.
  db.exec("DROP TABLE machine_project; DROP TABLE machines; DROP TABLE machine;");
  dropProfileColumns(db);
  db.exec("PRAGMA user_version = 2");
  return db;
}

/**
 * A database from before the user profile: today's declaration minus exactly the two columns
 * migration 5 adds, stamped at the version before it. Derived from SCHEMA_SQL for the reason
 * open024 is — a hand-copied `users` table would fork from reality.
 */
function openPreProfile(): DatabaseSync {
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec(SCHEMA_SQL);
  db.exec("DROP TABLE IF EXISTS model_provider_auth_tokens");
  db.exec("DROP TABLE IF EXISTS model_promotions");
  dropPortForwards(db);
  dropProfileColumns(db);
  // Version 4 predates company mode as well: its three migrations (6–8) come after the
  // profile's, so a database at 4 has none of their tables.
  dropCompanyTables(db);
  db.exec("PRAGMA user_version = 4");
  return db;
}

/** Takes everything migrations 6–8 create off a database built from the current declaration. */
function dropCompanyTables(db: DatabaseSync): void {
  db.exec(`
    DROP INDEX IF EXISTS idx_org_desk_notices_agent;
    DROP INDEX IF EXISTS idx_org_ticket_sessions_session;
    DROP INDEX IF EXISTS idx_org_sessions_org;
    DROP TABLE IF EXISTS org_desk_notices;
    DROP TABLE IF EXISTS org_budget_state;
    DROP TABLE IF EXISTS org_channel_reads;
    DROP TABLE IF EXISTS org_channel_state;
    DROP TABLE IF EXISTS org_ticket_state;
    DROP TABLE IF EXISTS org_calendar_state;
    DROP TABLE IF EXISTS org_ticket_sessions;
    DROP TABLE IF EXISTS org_sessions;
  `);
}

/** Takes migration 5's two columns off a database built from the current declaration. */
function dropProfileColumns(db: DatabaseSync): void {
  db.exec("ALTER TABLE users DROP COLUMN avatar");
  db.exec("ALTER TABLE users DROP COLUMN display_name");
}

/** Column names of `users`, for the two cases that are about columns rather than whole shapes. */
function userColumns(db: DatabaseSync): string[] {
  const rows = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  return rows.map((r) => r.name);
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

/** Every migration above `from`, in the order `migrate` applies them: what a root at `from` takes. */
const namesAfter = (from: number): string[] =>
  [...(MIGRATIONS as readonly { version: number; name: string }[])]
    .filter((m) => m.version > from)
    .sort((a, b) => a.version - b.version)
    .map((m) => m.name);

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

  /**
   * The session row's `surface` column reaches a LIVE deployment only this way. Its line in
   * openDatabase's ensureColumn list runs when the process starts, and a push never restarts
   * the runtime — so without the migration a pushed platform writes `surface` to a table
   * that has no such column, and every session insert fails: creation, fork, subagent
   * registration, and the Trace adoption the session list hydrates through.
   */
  it("grows the session surface column on the swap path, so a pushed platform can write sessions", () => {
    const db = new sqlite.DatabaseSync(":memory:");
    try {
      db.exec(SCHEMA_SQL);
      // A database as a running runtime holds it: migrated up to the version before this
      // column, and with the column itself absent — which is what a push finds.
      db.exec("ALTER TABLE sessions DROP COLUMN surface");
      db.exec("PRAGMA user_version = 10");
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

describe("pre-profile → current: user-profile", () => {
  it("adds both columns, and a database that already has them migrates the same", () => {
    const db = openPreProfile();
    const fresh = new sqlite.DatabaseSync(":memory:");
    try {
      fresh.exec(SCHEMA_SQL);
      expect(userColumns(db)).not.toContain("display_name");
      expect(migrate(db).applied).toEqual(
        MIGRATIONS.filter((m) => m.version > 4).map((m) => m.name),
      );
      expect(userColumns(db)).toContain("display_name");
      expect(userColumns(db)).toContain("avatar");
      expect(shape(db)).toBe(shape(fresh));

      // ADOPTION: on a database this build created, the declarative track already added both,
      // so the migration must find its work done, add nothing twice, and stamp anyway.
      fresh.exec("PRAGMA user_version = 4");
      expect(migrate(fresh).applied).toEqual(
        MIGRATIONS.filter((m) => m.version > 4).map((m) => m.name),
      );
      expect(userColumns(fresh).filter((c) => c === "avatar")).toEqual(["avatar"]);
    } finally {
      db.close();
      fresh.close();
    }
  });

  it("down removes both columns, taking every nickname and avatar with them", () => {
    const db = openPreProfile();
    try {
      db.exec(
        "INSERT INTO users (user_id, password_hash, is_admin, created_at) VALUES ('bob', 'h', 0, '2026-01-01T00:00:00Z')",
      );
      const before = shape(db);
      migrate(db);
      db.exec("UPDATE users SET display_name = 'Bob', avatar = 'data:image/png;base64,AAAA'");

      rollbackTo(db, 4);
      expect(shape(db)).toBe(before);
      expect(userColumns(db)).not.toContain("display_name");
      expect(userColumns(db)).not.toContain("avatar");
      // The account itself survives; only what the two columns held is gone.
      expect(db.prepare("SELECT user_id FROM users").all()).toEqual([{ user_id: "bob" }]);
    } finally {
      db.close();
    }
  });
});

describe("migration 6 → current: company-mode-channels", () => {
  it("renames both chat tables and puts channel_id in their primary keys, recreating them empty", () => {
    const db = open6();
    const fresh = new sqlite.DatabaseSync(":memory:");
    try {
      fresh.exec(SCHEMA_SQL);
      db.exec(
        "INSERT INTO org_chat_reads (project_id, org_id, user_id, last_read_id)" +
          " VALUES ('p1', 'acme', 'alice', 'msg-2026-09-01-00-00-00-00000000')",
      );
      expect(shape(db)).not.toBe(shape(fresh));

      expect(migrate(db).applied).toEqual(
        MIGRATIONS.filter((m) => m.version > 6).map((m) => m.name),
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
    const db = open6();
    const at6 = open6();
    try {
      migrate(db);
      rollbackTo(db, 6);
      expect(schemaVersion(db)).toBe(6);
      expect(shape(db)).toBe(shape(at6));
      expect(db.prepare("SELECT COUNT(*) AS n FROM org_chat_state").get()).toEqual({ n: 0 });
    } finally {
      db.close();
      at6.close();
    }
  });
});

describe("migration 7 → current: company-mode-desk-notices", () => {
  it("adds the queue a ticket change is delivered through, writable and indexed", () => {
    const db = open7();
    const fresh = new sqlite.DatabaseSync(":memory:");
    try {
      fresh.exec(SCHEMA_SQL);
      expect(shape(db)).not.toBe(shape(fresh));
      expect(migrate(db).applied).toEqual(
        MIGRATIONS.filter((m) => m.version > 7).map((m) => m.name),
      );
      expect(shape(db)).toBe(shape(fresh));
      db.exec(
        "INSERT INTO org_desk_notices (project_id, org_id, agent_id, ticket_id, change, at)" +
          " VALUES ('p1', 'acme', 'acme_hr', '2026-09-08-site', 'assigned', '2026-09-08T01:00:00Z')",
      );
      // seq is the delivery order, handed out by the table itself.
      expect(db.prepare("SELECT seq FROM org_desk_notices").all()).toEqual([{ seq: 1 }]);
    } finally {
      db.close();
      fresh.close();
    }
  });

  it("down drops the queue with the notices nobody has been told about yet", () => {
    const db = open7();
    const at7 = open7();
    try {
      migrate(db);
      db.exec(
        "INSERT INTO org_desk_notices (project_id, org_id, agent_id, ticket_id, change, at)" +
          " VALUES ('p1', 'acme', 'acme_hr', '2026-09-08-site', 'done', '2026-09-08T01:00:00Z')",
      );
      rollbackTo(db, 7);
      expect(schemaVersion(db)).toBe(7);
      expect(shape(db)).toBe(shape(at7));
    } finally {
      db.close();
      at7.close();
    }
  });
});

describe("migration 8 → current: model-promotions", () => {
  it("creates the promotions table, and its down drops it again", () => {
    const db = open8();
    const promotionsTableExists = () =>
      db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'model_promotions'")
        .get();
    const authTokensTableExists = () =>
      db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'model_provider_auth_tokens'",
        )
        .get();
    try {
      expect(migrate(db).applied).toEqual(namesAfter(8));
      expect(schemaVersion(db)).toBe(LATEST_VERSION);
      expect(promotionsTableExists()).toEqual({ "1": 1 });
      expect(authTokensTableExists()).toEqual({ "1": 1 });

      rollbackTo(db, 8);
      expect(schemaVersion(db)).toBe(8);
      expect(promotionsTableExists()).toBeUndefined();
      expect(authTokensTableExists()).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("is safe to create while a pushed platform boots", () => {
    const db = open8();
    try {
      expect(migrate(db, { swapPath: true }).applied).toEqual(namesAfter(8));
      expect(schemaVersion(db)).toBe(LATEST_VERSION);
    } finally {
      db.close();
    }
  });
});

describe("migration 9 → current: model-provider-auth-tokens", () => {
  it("creates the server-side refresh-token table, writable and rollback-safe", () => {
    const db = open9();
    const tableExists = () =>
      db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'model_provider_auth_tokens'",
        )
        .get();
    try {
      expect(migrate(db).applied).toEqual(namesAfter(9));
      expect(schemaVersion(db)).toBe(LATEST_VERSION);
      expect(tableExists()).toEqual({ "1": 1 });
      db.exec(
        "INSERT INTO users (user_id, password_hash, is_admin, created_at)" +
          " VALUES ('owner', 'hash', 1, '2026-09-20T00:00:00.000Z')",
      );
      db.exec(
        "INSERT INTO projects (project_id, owner_user_id, created_at)" +
          " VALUES ('p1', 'owner', '2026-09-20T00:00:00.000Z')",
      );
      db.exec(
        "INSERT INTO model_provider_auth_tokens (project_id, provider, refresh_token, access_token_expires_at, updated_at)" +
          " VALUES ('p1', 'modelscope', 'refresh', '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z')",
      );
      expect(db.prepare("SELECT refresh_token FROM model_provider_auth_tokens").all()).toEqual([
        { refresh_token: "refresh" },
      ]);

      rollbackTo(db, 9);
      expect(schemaVersion(db)).toBe(9);
      expect(tableExists()).toBeUndefined();
    } finally {
      db.close();
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

describe("a machines table from before migration 4", () => {
  /** The machines table as the machines line created it before release: forwards, no session, no platform. */
  const ADOPTED_MACHINES_DDL = `
    CREATE TABLE machines (
      address      TEXT PRIMARY KEY,
      machine_id   TEXT,
      version      TEXT,
      installed_at TEXT,
      forward_port INTEGER,
      forward_pid  INTEGER,
      remote_port  INTEGER
    );
  `;

  it("is adopted by migration 4 as it stands, and gains the columns the row writes at 10", () => {
    // What a data root that ran the machines line before its migration holds: IF NOT EXISTS
    // kept the table, and the first connect failed on the insert naming session_pid.
    const db = open029();
    try {
      db.exec(ADOPTED_MACHINES_DDL);
      db.exec("PRAGMA user_version = 3");
      expect(migrate(db).applied).toEqual(
        MIGRATIONS.filter((m) => m.version > 3).map((m) => m.name),
      );
      const columns = (db.prepare("PRAGMA table_info(machines)").all() as { name: string }[]).map(
        (c) => c.name,
      );
      expect(columns).toEqual(expect.arrayContaining(["session_pid", "platform"]));
      db.prepare(
        "INSERT INTO machines (address, machine_id, version, installed_at, session_pid, remote_port, platform) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run("ssh:nas", null, "9.9.9", "2026-09-04T00:00:00.000Z", 42, 7364, "linux");
      // Idempotent: a table that already has them is left as it is.
      expect(migrate(db).applied).toEqual([]);
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
      // Exactly the broken root: every table but port_forwards, stamped past this line's
      // port-forwards migration — what a hand-over onto a root the other line stamped leaves behind.
      db.exec("DROP TABLE port_forwards");
      db.exec("PRAGMA user_version = 15");
      const list = () => db.prepare("SELECT * FROM port_forwards").all();
      expect(list).toThrow(/no such table/);

      migrate(db, { swapPath: true });
      expect(list()).toEqual([]);
      expect(
        (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
      ).toBe(MIGRATIONS.length);

      // A root that took port-forwards in its proper place: the adoption finds its work done.
      const fresh = new sqlite.DatabaseSync(":memory:");
      try {
        fresh.exec(SCHEMA_SQL);
        fresh.exec("PRAGMA user_version = 15");
        migrate(fresh, { swapPath: true });
        expect(fresh.prepare("SELECT * FROM port_forwards").all()).toEqual([]);
      } finally {
        fresh.close();
      }
    } finally {
      db.close();
    }
  });
});

describe("a root stamped by the chain before its restack onto main: model-tables-adoption", () => {
  it("brings back model_promotions and model_provider_auth_tokens on the swap path, and a root that has them migrates the same", () => {
    const db = new sqlite.DatabaseSync(":memory:");
    try {
      db.exec(SCHEMA_SQL);
      // Exactly the broken root: every table but main's two model tables, stamped 16 under
      // the old line's numbering — where 9 and 10 were sessions-sandbox and machines-columns,
      // so this line reads its model-promotions (9) and model-provider-auth-tokens (10) as done.
      db.exec("DROP TABLE model_promotions");
      db.exec("DROP TABLE model_provider_auth_tokens");
      db.exec("PRAGMA user_version = 16");
      const promotions = () => db.prepare("SELECT * FROM model_promotions").all();
      const tokens = () => db.prepare("SELECT * FROM model_provider_auth_tokens").all();
      expect(promotions).toThrow(/no such table/);
      expect(tokens).toThrow(/no such table/);

      migrate(db, { swapPath: true });
      expect(promotions()).toEqual([]);
      expect(tokens()).toEqual([]);
      expect(
        (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
      ).toBe(MIGRATIONS.length);

      // A root that took 9 and 10 in their proper place: the adoption finds its work done.
      const fresh = new sqlite.DatabaseSync(":memory:");
      try {
        fresh.exec(SCHEMA_SQL);
        fresh.exec("PRAGMA user_version = 18");
        migrate(fresh, { swapPath: true });
        expect(fresh.prepare("SELECT * FROM model_promotions").all()).toEqual([]);
        expect(fresh.prepare("SELECT * FROM model_provider_auth_tokens").all()).toEqual([]);
      } finally {
        fresh.close();
      }
    } finally {
      db.close();
    }
  });
});

/**
 * The first form of `port_forwards`: what the port-forwards migration created on the roots
 * that ran it before its DDL was changed in place, and what the adoption still creates on the
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
  /** A root that ran port-forwards in its first form and has a forward saved, stamped at the adoption. */
  function openFirstForm(): DatabaseSync {
    const db = new sqlite.DatabaseSync(":memory:");
    db.exec(SCHEMA_SQL);
    db.exec("DROP INDEX IF EXISTS idx_port_forwards_local_in; DROP TABLE port_forwards;");
    db.exec(PORT_FORWARDS_V1_DDL);
    db.prepare(
      "INSERT INTO port_forwards (id, machine_id, workspace, remote_port, local_port, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("f1", "m1", "/home/dev/site", 3000, 3000, "2026-09-21T00:00:00.000Z");
    db.exec("PRAGMA user_version = 16");
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
      db.exec("DROP TABLE port_forwards");
      db.exec("PRAGMA user_version = 15");
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
      db.exec("PRAGMA user_version = 16");
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
      rollbackTo(db, 15);
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

  it("undoes a migration and moves the stamp back with it", () => {
    const db = open024();
    try {
      migrate(db);
      expect(schemaVersion(db)).toBe(LATEST_VERSION);

      // Back to version 1: everything after it is undone, so the columns migration 2 added are gone.
      const r = rollbackTo(db, 1);
      expect(r.from).toBe(LATEST_VERSION);
      expect(r.to).toBe(1);
      // Newest first, all the way down to 1.
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
      // And what the migrations above 1 created is gone with them; goal_state, which 3
      // dropped, is back.
      const tables = (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
          name: string;
        }[]
      ).map((t) => t.name);
      expect(tables).not.toContain("machines");
      expect(tables).not.toContain("machine_project");
      expect(tables).not.toContain("org_channel_reads");
      expect(tables).toContain("goal_state");
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
