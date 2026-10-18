/**
 * The PG backend against a real PostgreSQL: schema bootstrap, the upsert paths and the
 * transaction semantics the platform's synchronous data layer relies on.
 *
 * Skipped unless both hold, because neither is available on a normal `pnpm test` runner:
 *
 *  - `PENGUIN_TEST_PG_DSN` names a database the test may create a schema in, e.g.
 *    `postgres://user:pass@127.0.0.1:5432/postgres`
 *  - `packages/server/dist/db/pg/shim-entry.js` exists, i.e. the package was built: the shim
 *    loads its connection worker from dist (a worker cannot load TypeScript), so the test
 *    drives the built entry rather than the sources.
 *
 * Every run works in a schema of its own and drops it afterwards, so one database can serve
 * repeated runs and parallel checkouts without either seeing the other's rows.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SCHEMA_SQL } from "../src/db/schema.js";

interface PgConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  schema: string;
}

interface ShimStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | null };
}

interface ShimDatabase {
  exec(sql: string): void;
  prepare(sql: string): ShimStatement;
  close(): void;
}

interface ShimModule {
  openPgDatabase(cfg: PgConfig): ShimDatabase;
}

const dsn = process.env.PENGUIN_TEST_PG_DSN;
const distEntry = fileURLToPath(new URL("../dist/db/pg/shim-entry.js", import.meta.url));
const runnable = Boolean(dsn) && existsSync(distEntry);

describe.skipIf(!runnable)("PG backend against a real PostgreSQL", () => {
  it("bootstraps the platform schema and preserves the sync API's semantics", async () => {
    const url = new URL(dsn!);
    const schema = `penguin_test_${process.pid}_${Date.now()}`;
    const cfg: PgConfig = {
      host: url.hostname,
      port: Number(url.port || 5432),
      database: decodeURIComponent(url.pathname.replace(/^\//, "")) || "penguin",
      user: decodeURIComponent(url.username || "penguin"),
      password: decodeURIComponent(url.password || ""),
      schema,
    };
    const { openPgDatabase } = (await import(distEntry)) as ShimModule;
    const db = openPgDatabase(cfg);
    try {
      // The same script SQLite runs on open, unchanged: this is the whole schema.
      db.exec(SCHEMA_SQL);

      // int8 comes back as a number, as node:sqlite returns one (the repos do arithmetic on
      // counts without calling Number()).
      expect(db.prepare("SELECT count(*) AS n FROM sessions").get()).toEqual({ n: 0 });

      // INSERT OR REPLACE → ON CONFLICT DO UPDATE, keyed by the catalog's primary key.
      const upsert = db.prepare(
        "INSERT OR REPLACE INTO server_settings (key, value) VALUES (?, ?)",
      );
      expect(upsert.run("theme", "light").changes).toBe(1);
      expect(upsert.run("theme", "dark").changes).toBe(1);
      expect(db.prepare("SELECT value FROM server_settings WHERE key = ?").get("theme")).toEqual({
        value: "dark",
      });

      // Named parameters, including one name used twice (one binding, one placeholder).
      const named = db.prepare(
        "INSERT OR REPLACE INTO server_settings (key, value) VALUES (:key, :value)",
      );
      named.run({ key: "lang", value: "zh" });
      expect(
        db.prepare("SELECT value FROM server_settings WHERE key = :key OR value = :value").all({
          key: "lang",
          value: "zh",
        }),
      ).toHaveLength(1);

      // A transaction spans separate exec() calls on one handle, as node:sqlite's does.
      db.exec("BEGIN");
      db.exec("INSERT INTO server_settings (key, value) VALUES ('rolled_back', 'x')");
      db.exec("ROLLBACK");
      expect(
        db.prepare("SELECT count(*) AS n FROM server_settings WHERE key = 'rolled_back'").get(),
      ).toEqual({ n: 0 });

      // PRAGMA user_version, which the migrations use, maps onto _pg_meta.
      db.exec("PRAGMA user_version = 7");
      expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 7 });

      // PRAGMA table_info answers from information_schema (ensureColumn relies on it).
      const columns = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
      expect(columns.map((c) => c.name)).toContain("session_id");
    } finally {
      try {
        db.exec(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      } finally {
        db.close();
      }
    }
  }, 60_000);
});
