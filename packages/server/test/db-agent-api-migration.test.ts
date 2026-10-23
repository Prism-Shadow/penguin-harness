import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { appliedMigrations, migrate, rollbackTo } from "../src/db/migrations/index.js";
import { namesAfter, openFresh, record, shape } from "./db-migrations-fixtures.js";
/** A root whose line never declared 2026-10-10-agent-api, though it declared everything else. */
function openSkipped(): DatabaseSync {
  const db = openFresh();
  db.exec(
    "DROP INDEX IF EXISTS idx_agent_api_keys_agent; DROP TABLE IF EXISTS agent_api_keys; DROP TABLE IF EXISTS agent_api;",
  );
  record(
    db,
    namesAfter(null).filter((n) => n !== "2026-10-10-agent-api"),
  );
  return db;
}
describe("named 2026-10-10-agent-api migration", () => {
  it("creates the settings table while a pushed platform boots: one row per Agent, keyed and allow-all unless set", () => {
    const db = openSkipped();
    try {
      expect(migrate(db, { swapPath: true }).applied).toEqual(["2026-10-10-agent-api"]);
      expect(appliedMigrations(db)).toContain("2026-10-10-agent-api");
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
    const db = openSkipped();
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
    const db = openSkipped();
    const atSkipped = openSkipped();
    try {
      migrate(db);
      db.exec(
        "INSERT INTO agent_api (project_id, agent_id, enabled, updated_at)" +
          " VALUES ('p1', 'coder', 1, '2026-10-07T00:00:00.000Z')",
      );
      // 2026-10-10-agent-api ran last on this root: rolling back to the last other name undoes only it.
      const lastOther = namesAfter(null)
        .filter((n) => n !== "2026-10-10-agent-api")
        .at(-1)!;
      rollbackTo(db, lastOther);
      expect(appliedMigrations(db)).not.toContain("2026-10-10-agent-api");
      expect(shape(db)).toBe(shape(atSkipped));
      migrate(db);
      expect(db.prepare("SELECT COUNT(*) AS n FROM agent_api").get()).toEqual({ n: 0 });
    } finally {
      db.close();
      atSkipped.close();
    }
  });
});
