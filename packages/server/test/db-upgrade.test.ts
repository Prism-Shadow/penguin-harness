/**
 * openDatabase's per-column upgrade guard (ensureColumn): a web.db formed before a column
 * existed gets it ALTERed in on open — CREATE TABLE IF NOT EXISTS alone never touches an
 * existing table, so without the guard, code writing the new columns would break on every
 * pre-existing database.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../src/db/database.js";
import { SCHEMA_SQL } from "../src/db/schema.js";
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
