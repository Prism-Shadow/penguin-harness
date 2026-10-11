import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { appliedMigrations, migrate, rollbackTo } from "../src/db/migrations/index.js";
import { namesAfter, openFresh, record, shape, sqlite } from "./db-migrations-fixtures.js";
function open13(): DatabaseSync {
  const db = openFresh();
  db.exec("DROP INDEX IF EXISTS idx_agent_api_keys_agent; DROP TABLE IF EXISTS agent_api_keys; DROP TABLE IF EXISTS agent_api;");
  // A root that has run everything but agent-api: the fixture names what it lacks, so the
  // migration list growing after it (this line's own later migrations) never widens `applied`.
  record(db, namesAfter(null).filter((name) => name !== "agent-api"));
  db.exec("PRAGMA user_version = 13");
  return db;
}
describe("named agent-api migration", () => {
  it("creates the settings table while a pushed platform boots: one row per Agent, keyed and allow-all unless set", () => {
    const db = open13();
    try {
      expect(migrate(db, { swapPath: true }).applied).toEqual(["agent-api"]);
      expect(appliedMigrations(db)).toContain("agent-api");
      const enable = () =>
        db
          .prepare(
            "INSERT INTO agent_api (project_id, agent_id, enabled, updated_at)" +
              " VALUES ('p1', 'coder', 1, '2026-10-07T00:00:00.000Z')",
          )
          .run();
      enable();
      expect(db.prepare("SELECT enabled, open, approval_mode FROM agent_api").all()).toEqual([
        { enabled: 1, open: 0, approval_mode: "allow-all" },
      ]);
      // The (project, agent) pair is the key: a second row for the same Agent is refused.
      expect(enable).toThrow(/UNIQUE/);
    } finally {
      db.close();
    }
  });

  it("creates the keys table, which holds one key per token hash and only keys a user created", () => {
    const db = open13();
    try {
      migrate(db);
      db.exec("PRAGMA foreign_keys = ON");
      db.exec(
        "INSERT INTO users (user_id, password_hash, is_admin, created_at)" +
          " VALUES ('alice', 'hash', 0, '2026-10-07T00:00:00.000Z')",
      );
      const insert = (keyId: string, hash: string, createdBy: string) =>
        db
          .prepare(
            "INSERT INTO agent_api_keys (key_id, project_id, agent_id, token_hash, prefix, name, created_by, created_at)" +
              " VALUES (?, 'p1', 'coder', ?, 'penguin_abcdefgh', 'ci', ?, '2026-10-07T00:00:00.000Z')",
          )
          .run(keyId, hash, createdBy);
      insert("k1", "h1", "alice");
      // A token hash names one key, so the lookup by hash is never ambiguous.
      expect(() => insert("k2", "h1", "alice")).toThrow(/UNIQUE/);
      expect(() => insert("k3", "h3", "ghost")).toThrow(/FOREIGN KEY/);
      expect(db.prepare("SELECT key_id, last_used_at FROM agent_api_keys").all()).toEqual([
        { key_id: "k1", last_used_at: null },
      ]);
    } finally {
      db.close();
    }
  });

  it("down drops the settings and every key, and a second up recreates both empty", () => {
    const db = open13();
    const at13 = open13();
    try {
      migrate(db);
      db.exec(
        "INSERT INTO agent_api (project_id, agent_id, enabled, updated_at)" +
          " VALUES ('p1', 'coder', 1, '2026-10-07T00:00:00.000Z')",
      );
      const previous = [...appliedMigrations(db)].filter((name) => name !== "agent-api").at(-1)!;
      rollbackTo(db, previous);
      expect(appliedMigrations(db)).not.toContain("agent-api");
      expect(shape(db)).toBe(shape(at13));
      migrate(db);
      expect(db.prepare("SELECT COUNT(*) AS n FROM agent_api").get()).toEqual({ n: 0 });
    } finally {
      db.close();
      at13.close();
    }
  });
});
