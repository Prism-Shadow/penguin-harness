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
import { openDatabase } from "../src/db/database.js";
import { SessionsRepo } from "../src/db/repos/sessions.js";

const sqlite = process.getBuiltinModule("node:sqlite");

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "penguin-db-upgrade-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

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
      expect(repo.listByAgent("p1", "a1", { webOnly: true }).map((r) => r.sessionId)).toEqual([
        "session-legacy",
      ]);
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
      });
      expect(repo.findById("session-new")!.client).toBe("cli");
      expect(repo.listByAgent("p1", "a1", { webOnly: true }).map((r) => r.sessionId)).toEqual([
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
    } finally {
      db.close();
    }
  });
});
