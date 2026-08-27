/**
 * openDatabase's per-column upgrade guard (ensureColumn): a web.db formed before a column
 * existed gets it ALTERed in on open — CREATE TABLE IF NOT EXISTS alone never touches an
 * existing table, so without the guard, code writing the new columns would break on every
 * pre-existing database.
 *
 * The last two suites cover the other two directions a released build meets on disk: a table
 * that did not exist when the database was formed, a column added to it afterwards, and an
 * index that has since been retired — the one shape openDatabase removes rather than adds — and
 * a database
 * written by a *newer* build than the one opening it (a user who updates, dislikes it, and
 * reinstalls the previous release). Nothing records a schema version, so both properties rest
 * on every schema change staying additive — and the downgrade one on more than that, which the
 * last suite pins next to the tolerance rather than leaving it implied.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../src/db/database.js";
import { SCHEMA_SQL } from "../src/db/schema.js";
import { MessagingBindingsRepo } from "../src/db/repos/messaging-bindings.js";
import { SessionsRepo } from "../src/db/repos/sessions.js";
import type { SessionRow } from "../src/db/repos/sessions.js";

const sqlite = process.getBuiltinModule("node:sqlite");

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "penguin-db-upgrade-"));
});
afterEach(async () => {
  // maxRetries for the same reason helpers.ts documents: on Windows a handle that is
  // closing can hold the directory briefly, and an unretried rm turns that into a failure.
  await rm(dir, { recursive: true, force: true, maxRetries: 10 });
});

/**
 * Seeds a database in the shape it had **before** last_active_at existed, derived from the
 * real SCHEMA_SQL rather than a hand-copied DDL replica (a copy silently forks from the
 * schema it is supposed to imitate): create today's schema, then undo exactly the two
 * things this change introduced — the column, and the reshaped usage index.
 */
function seedPreLastActiveDb(dbPath: string, seed: (db: DatabaseSync) => void): void {
  const db = new sqlite.DatabaseSync(dbPath);
  try {
    db.exec(SCHEMA_SQL);
    db.exec("ALTER TABLE sessions DROP COLUMN last_active_at");
    db.exec("DROP INDEX IF EXISTS idx_usage_session_ts");
    db.exec("CREATE INDEX IF NOT EXISTS idx_usage_session ON usage_records(session_id)");
    seed(db);
  } finally {
    db.close();
  }
}

/** Reads the stored cell directly, bypassing mapRow's coalesce (which would mask a NULL). */
function rawLastActive(db: DatabaseSync, sessionId: string): unknown {
  const r = db
    .prepare("SELECT last_active_at AS v FROM sessions WHERE session_id = ?")
    .get(sessionId) as { v: unknown } | undefined;
  return r?.v;
}

describe("openDatabase column upgrade", () => {
  it("adds client/has_trace to a sessions table formed before the columns existed", () => {
    const dbPath = path.join(dir, "web.db");
    // A database formed by the pre-#139 schema: sessions without client / has_trace.
    const old = new sqlite.DatabaseSync(dbPath);
    old.exec(`CREATE TABLE sessions (
      session_id    TEXT PRIMARY KEY,
      project_id    TEXT NOT NULL,
      agent_id      TEXT NOT NULL,
      provider      TEXT NOT NULL,
      model_id      TEXT NOT NULL,
      workspace     TEXT NOT NULL,
      approval_mode TEXT NOT NULL DEFAULT 'allow-all',
      title         TEXT,
      archived_at   TEXT,
      created_at    TEXT NOT NULL
    );`);
    old
      .prepare(
        `INSERT INTO sessions (session_id, project_id, agent_id, provider, model_id, workspace, created_at)
       VALUES ('session-legacy', 'p1', 'a1', 'custom', 'm1', '/w', '2026-01-01T00:00:00.000Z')`,
      )
      .run();
    old.close();

    const db = openDatabase(dbPath);
    try {
      const repo = new SessionsRepo(db);
      // The legacy row reads back with the grandfathered defaults: client NULL (treated as
      // web — it stays in the default list) and has_trace false.
      const legacy = repo.findById("session-legacy");
      expect(legacy).not.toBeNull();
      expect(legacy!.client).toBeNull();
      expect(legacy!.hasTrace).toBe(false);
      expect(
        db.prepare("SELECT fork_count FROM sessions WHERE session_id = ?").get("session-legacy"),
      ).toEqual({ fork_count: 0 });
      // last_active_at is ALTERed in too; with no usage_records the backfill falls to created_at.
      expect(legacy!.lastActiveAt).toBe("2026-01-01T00:00:00.000Z");
      expect(repo.listByAgent("p1", "a1").map((r) => r.sessionId)).toEqual(["session-legacy"]);
      // The upgraded table accepts writes to the new columns.
      repo.insert({
        sessionId: "session-new",
        projectId: "p1",
        agentId: "a1",
        provider: "custom",
        modelId: "m1",
        workspace: "/w",
        approvalMode: "allow-all",
        title: null,
        client: "cli",
        hasTrace: true,
        createdAt: "2026-01-02T00:00:00.000Z",
        lastActiveAt: "2026-01-02T00:00:00.000Z",
      });
      expect(repo.findById("session-new")!.client).toBe("cli");
      // Listing carries every row whichever client created it — the client column is
      // provenance, not a filter.
      expect(repo.listByAgent("p1", "a1").map((r) => r.sessionId)).toEqual([
        "session-new",
        "session-legacy",
      ]);
      repo.markHasTrace("session-legacy");
      expect(repo.findById("session-legacy")!.hasTrace).toBe(true);
    } finally {
      db.close();
    }
  });

  it("is idempotent: reopening an already-upgraded database changes nothing", () => {
    const dbPath = path.join(dir, "web.db");
    openDatabase(dbPath).close();
    const db = openDatabase(dbPath);
    try {
      const cols = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
      expect(cols.filter((c) => c.name === "client")).toHaveLength(1);
      expect(cols.filter((c) => c.name === "has_trace")).toHaveLength(1);
      expect(cols.filter((c) => c.name === "fork_count")).toHaveLength(1);
      expect(cols.filter((c) => c.name === "last_active_at")).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("backfills last_active_at once: last request timestamp when the session has usage, else created_at", () => {
    const dbPath = path.join(dir, "web.db");
    seedPreLastActiveDb(dbPath, (old) => {
      const insertSession = old.prepare(
        `INSERT INTO sessions (session_id, project_id, agent_id, provider, model_id, workspace, created_at)
         VALUES (?, 'p1', 'a1', 'custom', 'm1', '/w', ?)`,
      );
      insertSession.run("session-used", "2026-01-01T00:00:00.000Z");
      insertSession.run("session-quiet", "2026-01-02T00:00:00.000Z");
      const insertUsage = old.prepare(
        `INSERT INTO usage_records (ts, date, project_id, agent_id, session_id, provider, model_id, cache_read, cache_write, output, total)
         VALUES (?, ?, 'p1', 'a1', 'session-used', 'custom', 'm1', 0, 0, 1, 1)`,
      );
      insertUsage.run("2026-02-01T10:00:00.000Z", "2026-02-01");
      insertUsage.run("2026-02-03T09:30:00.000Z", "2026-02-03");
    });

    const db = openDatabase(dbPath);
    try {
      const repo = new SessionsRepo(db);
      // The most recent request timestamp is the closest persisted proxy for last Trace
      // activity. Read raw as well: mapRow would report created_at for a row the backfill
      // never touched, hiding a no-op migration behind a plausible-looking value.
      expect(rawLastActive(db, "session-used")).toBe("2026-02-03T09:30:00.000Z");
      expect(repo.findById("session-used")!.lastActiveAt).toBe("2026-02-03T09:30:00.000Z");
      // No usage rows: falls back to the row's own created_at.
      expect(rawLastActive(db, "session-quiet")).toBe("2026-01-02T00:00:00.000Z");
      // The reshaped usage index is in place and the superseded one is gone.
      const indexes = (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_usage%'")
          .all() as { name: string }[]
      ).map((r) => r.name);
      expect(indexes).toContain("idx_usage_session_ts");
      expect(indexes).not.toContain("idx_usage_session");
      // A live value written after the upgrade must survive reopens.
      repo.touchLastActive("session-quiet", "2026-03-01T00:00:00.000Z");
    } finally {
      db.close();
    }

    const reopened = openDatabase(dbPath);
    try {
      const repo = new SessionsRepo(reopened);
      expect(repo.findById("session-used")!.lastActiveAt).toBe("2026-02-03T09:30:00.000Z");
      expect(repo.findById("session-quiet")!.lastActiveAt).toBe("2026-03-01T00:00:00.000Z");
    } finally {
      reopened.close();
    }
  });

  it("the backfill is gated on the ALTER: a later open neither re-runs it nor rewrites a row", () => {
    const dbPath = path.join(dir, "web.db");
    seedPreLastActiveDb(dbPath, (old) => {
      old
        .prepare(
          `INSERT INTO sessions (session_id, project_id, agent_id, provider, model_id, workspace, created_at)
           VALUES ('session-1', 'p1', 'a1', 'custom', 'm1', '/w', '2026-01-01T00:00:00.000Z')`,
        )
        .run();
    });
    const first = openDatabase(dbPath);
    // Blank the cell by hand: only a re-running backfill would fill it in again, so this
    // pins that the migration is scoped to the open that actually adds the column (a
    // `sessions` full scan on every open forever is the cost of getting this wrong).
    first.exec("UPDATE sessions SET last_active_at = NULL");
    first.close();

    const db = openDatabase(dbPath);
    try {
      expect(rawLastActive(db, "session-1")).toBeNull();
      // ...and mapRow's coalesce is what keeps that invisible to callers: the safety net,
      // not the mechanism (nothing else can repair a NULL once the gate has closed).
      expect(new SessionsRepo(db).findById("session-1")!.lastActiveAt).toBe(
        "2026-01-01T00:00:00.000Z",
      );
    } finally {
      db.close();
    }
  });
});

describe("SessionsRepo last_active_at writes", () => {
  let db: DatabaseSync;
  let repo: SessionsRepo;
  const base = {
    projectId: "p1",
    agentId: "a1",
    provider: "custom",
    modelId: "m1",
    workspace: "/w",
    approvalMode: "allow-all" as const,
    title: null,
    createdAt: "2026-05-01T00:00:00.000Z",
  };

  beforeEach(() => {
    db = openDatabase(":memory:");
    repo = new SessionsRepo(db);
  });
  afterEach(() => {
    db.close();
  });

  it("both insert paths store a non-NULL cell, defaulting to created_at in SQL", () => {
    repo.insert({ ...base, sessionId: "s-insert", lastActiveAt: base.createdAt });
    repo.insertOrIgnore({ ...base, sessionId: "s-ignore", lastActiveAt: base.createdAt });
    // The column is nullable (ALTER TABLE cannot add a DEFAULT), so the statement's own
    // COALESCE is the guarantee — a caller reaching the repo without the field (JS, or a
    // row shape built before it existed) must still leave a usable cell behind. Asserted
    // on the raw cells: every mapped read coalesces, so a NULL would look identical there.
    repo.insert({ ...base, sessionId: "s-missing" } as SessionRow);
    repo.insertOrIgnore({ ...base, sessionId: "s-missing-ignore" } as SessionRow);
    for (const id of ["s-insert", "s-ignore", "s-missing", "s-missing-ignore"]) {
      expect(rawLastActive(db, id)).toBe(base.createdAt);
    }
    // An explicit value is stored as given, not overwritten by the default.
    repo.insert({ ...base, sessionId: "s-explicit", lastActiveAt: "2026-06-01T00:00:00.000Z" });
    expect(rawLastActive(db, "s-explicit")).toBe("2026-06-01T00:00:00.000Z");
  });

  it("markDriven and touchLastActive only ever move the stamp forward", () => {
    repo.insert({ ...base, sessionId: "s1", lastActiveAt: base.createdAt });
    repo.markDriven("s1", "2026-05-02T00:00:00.000Z");
    expect(repo.findById("s1")!.lastActiveAt).toBe("2026-05-02T00:00:00.000Z");
    expect(repo.findById("s1")!.hasTrace).toBe(true); // markDriven folds in the has_trace flip
    repo.touchLastActive("s1", "2026-05-03T00:00:00.000Z");
    expect(repo.findById("s1")!.lastActiveAt).toBe("2026-05-03T00:00:00.000Z");
    // A backwards clock (NTP step, resume from suspend) must not regress the row.
    repo.touchLastActive("s1", "2026-05-01T12:00:00.000Z");
    repo.markDriven("s1", "2026-04-01T00:00:00.000Z");
    expect(repo.findById("s1")!.lastActiveAt).toBe("2026-05-03T00:00:00.000Z");
  });

  it("writes for one Session leave every other row alone", () => {
    repo.insert({ ...base, sessionId: "s1", lastActiveAt: base.createdAt });
    repo.insert({ ...base, sessionId: "s2", lastActiveAt: base.createdAt });
    repo.markDriven("s1", "2026-05-09T00:00:00.000Z");
    repo.touchLastActive("s1", "2026-05-10T00:00:00.000Z");
    expect(repo.findById("s2")!.lastActiveAt).toBe(base.createdAt);
    expect(repo.findById("s2")!.hasTrace).toBe(false);
  });
});

/**
 * A table added to the schema after a web.db was formed. CREATE TABLE IF NOT EXISTS is the
 * whole mechanism — it creates the missing table and skips every table already there — so the
 * property to hold is that the new table (and its unique index) arrive on open while the rows
 * that were already on disk are untouched. `messaging_bindings` is the real instance: it
 * shipped in 0.2.5, so every database formed by 0.2.4 or earlier meets this path.
 */
describe("openDatabase table and index upgrades", () => {
  /**
   * Seeds a database in the shape it had **before** messaging_bindings existed, derived from
   * the real SCHEMA_SQL rather than a hand-copied DDL replica: create today's schema, then
   * drop exactly what that change introduced (dropping the table takes its index with it).
   */
  function seedPreMessagingDb(dbPath: string, seed: (db: DatabaseSync) => void): void {
    const db = new sqlite.DatabaseSync(dbPath);
    try {
      db.exec(SCHEMA_SQL);
      db.exec("DROP TABLE messaging_bindings");
      seed(db);
    } finally {
      db.close();
    }
  }

  it("creates messaging_bindings on a database formed before it existed, keeping existing rows", () => {
    const dbPath = path.join(dir, "web.db");
    seedPreMessagingDb(dbPath, (old) => {
      old
        .prepare(
          `INSERT INTO sessions (session_id, project_id, agent_id, provider, model_id, workspace, created_at)
           VALUES ('session-pre-messaging', 'p1', 'a1', 'custom', 'm1', '/w', '2026-01-01T00:00:00.000Z')`,
        )
        .run();
    });
    // Read the pre-state and close before asserting on it: a failed expect between open and
    // close leaks the handle, which is exactly what afterEach's rm cannot survive on Windows.
    const beforeTables = new sqlite.DatabaseSync(dbPath);
    let tablesBefore: unknown[];
    try {
      tablesBefore = beforeTables
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'messaging_bindings'",
        )
        .all();
    } finally {
      beforeTables.close();
    }
    expect(tablesBefore).toEqual([]);

    const db = openDatabase(dbPath);
    try {
      // The table and its by-account lookup index both arrive; the pre-existing Session is
      // still there, which is what makes this an upgrade rather than a reset.
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_messaging_by_account'",
          )
          .all(),
      ).toHaveLength(1);
      expect(new SessionsRepo(db).findById("session-pre-messaging")).not.toBeNull();
      // And it is immediately writable — a newly created table with no rows would look
      // identical to one the upgrade forgot to create until something tries to use it.
      const repo = new MessagingBindingsRepo(db);
      expect(
        repo.upsert({
          sessionId: "session-pre-messaging",
          channel: "telegram",
          accountId: "12345",
          config: { botToken: "t" },
        }).accountId,
      ).toBe("12345");
      expect(repo.find("session-pre-messaging", "telegram")?.accountId).toBe("12345");
    } finally {
      db.close();
    }
  });

  /**
   * Seeds a database in the shape it had before messaging_bindings.line_per_message existed:
   * today's schema with that column dropped. Same derivation rule as the helpers around it.
   */
  function seedPreLinePerMessageDb(dbPath: string, seed: (db: DatabaseSync) => void): void {
    const db = new sqlite.DatabaseSync(dbPath);
    try {
      db.exec(SCHEMA_SQL);
      db.exec("ALTER TABLE messaging_bindings DROP COLUMN line_per_message");
      seed(db);
    } finally {
      db.close();
    }
  }

  it("adds line_per_message to a messaging_bindings formed before it, existing rows off", () => {
    const dbPath = path.join(dir, "web.db");
    const ts = "2026-01-01T00:00:00.000Z";
    seedPreLinePerMessageDb(dbPath, (old) => {
      old
        .prepare(
          `INSERT INTO messaging_bindings
             (session_id, channel, account_id, config_json, enabled, created_at, updated_at)
           VALUES ('session-old', 'telegram', '12345', '{"botToken":"t"}', 1, ?, ?)`,
        )
        .run(ts, ts);
    });
    const before = new sqlite.DatabaseSync(dbPath);
    let columnsBefore: { name: string }[];
    try {
      columnsBefore = before.prepare("PRAGMA table_info(messaging_bindings)").all() as {
        name: string;
      }[];
    } finally {
      before.close();
    }
    expect(columnsBefore.map((c) => c.name)).not.toContain("line_per_message");

    const db = openDatabase(dbPath);
    try {
      const repo = new MessagingBindingsRepo(db);
      const row = repo.find("session-old", "telegram");
      // The column arrives with a default that reproduces the behaviour the row already had —
      // one message per reply — so the upgrade cannot change how an existing binding delivers.
      expect(row?.linePerMessage).toBe(false);
      // And the rest of the row is untouched, including the connection intent.
      expect(row?.enabled).toBe(true);
      expect(row?.config.botToken).toBe("t");
      // It is writable immediately: an ALTERed column with no backing code path would look
      // identical until something tried to set it.
      expect(
        repo.upsert({
          sessionId: "session-old",
          channel: "telegram",
          accountId: "12345",
          config: { botToken: "t" },
          linePerMessage: true,
        }).linePerMessage,
      ).toBe(true);
    } finally {
      db.close();
    }
  });

  /**
   * Seeds a database in the shape it had while a bot account belonged to ONE Session forever:
   * today's schema with the by-account index swapped back to the UNIQUE one it used to be.
   * Same derivation rule as the helper above — a hand-copied DDL replica forks silently from
   * the schema it is imitating.
   */
  function seedUniqueAccountIndexDb(dbPath: string, seed: (db: DatabaseSync) => void): void {
    const db = new sqlite.DatabaseSync(dbPath);
    try {
      db.exec(SCHEMA_SQL);
      db.exec("DROP INDEX idx_messaging_by_account");
      db.exec(
        "CREATE UNIQUE INDEX idx_messaging_account ON messaging_bindings(channel, account_id)",
      );
      seed(db);
    } finally {
      db.close();
    }
  }

  it("drops the retired unique account index, so one bot account fits on two Sessions", () => {
    const dbPath = path.join(dir, "web.db");
    const ts = "2026-01-01T00:00:00.000Z";
    seedUniqueAccountIndexDb(dbPath, (old) => {
      old
        .prepare(
          `INSERT INTO messaging_bindings
             (session_id, channel, account_id, config_json, created_at, updated_at)
           VALUES ('session-a', 'telegram', '12345', '{"botToken":"t"}', ?, ?)`,
        )
        .run(ts, ts);
    });
    // Read the pre-state and close before asserting on it, for the same reason the sibling
    // test does: a failed expect between open and close leaks the handle.
    const before = new sqlite.DatabaseSync(dbPath);
    let indexBefore: unknown[];
    try {
      indexBefore = before
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_messaging_account'",
        )
        .all();
    } finally {
      before.close();
    }
    expect(indexBefore).toHaveLength(1);

    const db = openDatabase(dbPath);
    try {
      // The unique index is gone and the plain lookup index over the same columns is there.
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_messaging_account'",
          )
          .all(),
      ).toEqual([]);
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_messaging_by_account'",
          )
          .all(),
      ).toHaveLength(1);
      // The row written under the old rule survived, and a second Session may now keep the
      // same account saved beside it — the write the unique index used to reject.
      const repo = new MessagingBindingsRepo(db);
      expect(repo.find("session-a", "telegram")?.accountId).toBe("12345");
      expect(
        repo.upsert({
          sessionId: "session-b",
          channel: "telegram",
          accountId: "12345",
          config: { botToken: "t2" },
        }).sessionId,
      ).toBe("session-b");
      expect(
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM messaging_bindings WHERE channel = 'telegram' AND account_id = '12345'",
          )
          .get(),
      ).toEqual({ n: 2 });
      // Neither row is enabled, so the lookup the enable guard reads still finds nobody:
      // saving is not binding, and only an enabled row can hold the account.
      expect(repo.findEnabledByAccount("telegram", "12345")).toBeNull();
      // The drop is ONE-WAY, which is the cost of it: an older build recreates the unique
      // index on open, and over these two rows that statement — its own SCHEMA_SQL, verbatim
      // — fails, so the older build cannot open this database at all.
      expect(() =>
        db.exec(
          "CREATE UNIQUE INDEX IF NOT EXISTS idx_messaging_account ON messaging_bindings(channel, account_id)",
        ),
      ).toThrow(/UNIQUE constraint failed/);
    } finally {
      db.close();
    }
  });

  it("an already-enabled binding survives the upgrade and still holds its account", () => {
    const dbPath = path.join(dir, "web.db");
    const ts = "2026-01-01T00:00:00.000Z";
    // The upgrade that actually happens to a user: not a dormant row, but a live connection
    // they left switched on. It must come back enabled, and it must still be the holder the
    // enable guard refuses a second Session against.
    seedUniqueAccountIndexDb(dbPath, (old) => {
      old
        .prepare(
          `INSERT INTO messaging_bindings
             (session_id, channel, account_id, config_json, enabled, created_at, updated_at)
           VALUES ('session-a', 'telegram', '99999', '{"botToken":"t"}', 1, ?, ?)`,
        )
        .run(ts, ts);
    });
    const db = openDatabase(dbPath);
    try {
      const repo = new MessagingBindingsRepo(db);
      expect(repo.find("session-a", "telegram")?.enabled).toBe(true);
      expect(repo.findEnabledByAccount("telegram", "99999")?.sessionId).toBe("session-a");
    } finally {
      db.close();
    }
  });
});

/**
 * The downgrade direction: a database written by a **newer** build, opened by this one. It is
 * what a user produces by updating, disliking the update and reinstalling the previous
 * release, and it is the direction with no safety net at all — nothing stamps a schema
 * version, so an older build cannot tell it is looking at a newer database and simply proceeds.
 *
 * That is safe only while every schema change is additive, which is the first invariant
 * asserted here: tables and columns this build has never heard of must survive the open
 * untouched, because the only thing standing between them and deletion is that no code path
 * drops what it does not recognize.
 *
 * Additive is necessary but not sufficient, which the second test pins: two changes that add
 * and remove nothing — a NOT NULL column with no default, a new unique index — still land on
 * this build's own writes. Read together the pair states the real rule a future schema change
 * has to obey, and the second half is the half that is easy to miss.
 */
describe("openDatabase tolerates a database from a newer build", () => {
  /**
   * `sessions` as a newer build that FORMED the database would have written it: the real
   * SCHEMA_SQL with one column spliced in, so the fixture cannot fork from the schema it
   * imitates. It throws rather than returning the schema unchanged when the anchor moves — a
   * splice that silently stops splicing leaves a test that passes forever and asserts nothing.
   */
  function schemaWithExtraSessionsColumn(ddl: string): string {
    const anchor = "  last_active_at TEXT,";
    if (!SCHEMA_SQL.includes(anchor)) {
      throw new Error(`sessions anchor missing from SCHEMA_SQL: ${anchor}`);
    }
    return SCHEMA_SQL.replace(anchor, `${anchor}\n  ${ddl},`);
  }

  it("leaves unknown tables, columns and indexes intact across an open", () => {
    const dbPath = path.join(dir, "web.db");
    const current = openDatabase(dbPath);
    new SessionsRepo(current).insert({
      sessionId: "s1",
      projectId: "p1",
      agentId: "a1",
      provider: "custom",
      modelId: "m1",
      workspace: "/w",
      approvalMode: "allow-all",
      title: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      lastActiveAt: "2026-05-01T00:00:00.000Z",
    });
    // Stand in for a future release: a table this build has never heard of, a column added to
    // one it owns, and an index over that column. The column carries a DEFAULT because that is
    // what SQLite's ALTER TABLE ADD COLUMN requires, so it is what a future ensureColumn entry
    // would carry too — which is why this build's own inserts keep working here. A newer build
    // that FORMS the database is under no such constraint; the next test covers that.
    current.exec(`
      CREATE TABLE future_feature (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      INSERT INTO future_feature (id, payload) VALUES ('f1', 'written by a newer build');
      ALTER TABLE sessions ADD COLUMN future_flag INTEGER NOT NULL DEFAULT 7;
      CREATE INDEX idx_future_flag ON sessions(future_flag);
    `);
    current.close();

    const reopened = openDatabase(dbPath);
    try {
      // The unknown table and its row are untouched.
      expect(reopened.prepare("SELECT payload FROM future_feature WHERE id = 'f1'").get()).toEqual({
        payload: "written by a newer build",
      });
      // So is the unknown column and the index over it.
      expect(
        reopened.prepare("SELECT future_flag FROM sessions WHERE session_id = 's1'").get(),
      ).toEqual({ future_flag: 7 });
      expect(
        reopened
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_future_flag'",
          )
          .all(),
      ).toHaveLength(1);
      // And this build still reads and writes the rows it does own, alongside the column it
      // cannot see — the unknown column's DEFAULT is what keeps this insert legal.
      const repo = new SessionsRepo(reopened);
      expect(repo.findById("s1")!.lastActiveAt).toBe("2026-05-01T00:00:00.000Z");
      repo.insert({
        sessionId: "s2",
        projectId: "p1",
        agentId: "a1",
        provider: "custom",
        modelId: "m1",
        workspace: "/w",
        approvalMode: "allow-all",
        title: null,
        createdAt: "2026-05-02T00:00:00.000Z",
        lastActiveAt: "2026-05-02T00:00:00.000Z",
      });
      expect(repo.listByAgent("p1", "a1").map((r) => r.sessionId)).toEqual(["s2", "s1"]);
    } finally {
      reopened.close();
    }
  });

  it("a defaultless NOT NULL column or a new unique index still breaks this build's writes", () => {
    // Neither change removes anything, so both pass an "is it additive?" reading — and both
    // leave this build opening the database happily and then failing on its first write. The
    // open is where a version stamp would be checked, so the failure surfaces at an arbitrary
    // later moment instead; that is the cost of not having one, stated as an assertion.

    // 1. A NOT NULL column with no default. SQLite forbids that shape in ALTER TABLE ADD
    //    COLUMN, which is what makes every ensureColumn entry safe — but a newer build that
    //    forms the database writes CREATE TABLE, where the shape is perfectly legal.
    const formedByNewer = path.join(dir, "formed-by-newer.db");
    const newer = new sqlite.DatabaseSync(formedByNewer);
    try {
      newer.exec(schemaWithExtraSessionsColumn("future_required TEXT NOT NULL"));
    } finally {
      newer.close();
    }
    const opened = openDatabase(formedByNewer);
    try {
      expect(() =>
        new SessionsRepo(opened).insert({
          sessionId: "s1",
          projectId: "p1",
          agentId: "a1",
          provider: "custom",
          modelId: "m1",
          workspace: "/w",
          approvalMode: "allow-all",
          title: null,
          createdAt: "2026-05-01T00:00:00.000Z",
          lastActiveAt: "2026-05-01T00:00:00.000Z",
        }),
      ).toThrow(/NOT NULL constraint failed: sessions\.future_required/);
    } finally {
      opened.close();
    }

    // 2. A unique index over columns this build already writes. Nothing is added to any row,
    //    yet rows this build creates today stop being insertable.
    const withUniqueIndex = path.join(dir, "unique-index.db");
    const newerIndexed = openDatabase(withUniqueIndex);
    try {
      newerIndexed.exec(
        "CREATE UNIQUE INDEX idx_future_one_session_per_agent ON sessions(project_id, agent_id)",
      );
    } finally {
      newerIndexed.close();
    }
    const reopenedIndexed = openDatabase(withUniqueIndex);
    try {
      const repo = new SessionsRepo(reopenedIndexed);
      const row = {
        projectId: "p1",
        agentId: "a1",
        provider: "custom",
        modelId: "m1",
        workspace: "/w",
        approvalMode: "allow-all" as const,
        title: null,
        createdAt: "2026-05-01T00:00:00.000Z",
        lastActiveAt: "2026-05-01T00:00:00.000Z",
      };
      repo.insert({ ...row, sessionId: "s1" });
      expect(() => repo.insert({ ...row, sessionId: "s2" })).toThrow(/UNIQUE constraint failed/);
    } finally {
      reopenedIndexed.close();
    }
  });
});
