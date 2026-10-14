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
} from "./db-migrations-fixtures.js";

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
      // A root whose builds never declared 2026-09-17-model-promotions, though they declared what follows it.
      db.exec("DROP TABLE model_promotions");
      record(
        db,
        namesAfter(null).filter((n) => n !== "2026-09-17-model-promotions"),
      );
      expect(migrate(db).applied).toEqual(["2026-09-17-model-promotions"]);
      expect(hasTable(db, "model_promotions")).toBe(true);
      // Recorded where it actually ran: last.
      expect(appliedMigrations(db).at(-1)).toBe("2026-09-17-model-promotions");
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
      const half = namesThrough("2026-09-14-user-profile").length;
      const cut = [...MIGRATIONS.slice(0, half), boom, ...MIGRATIONS.slice(half)];
      expect(() => runner.migrate(db, cut)).toThrow(/stops-here/);
      expect(appliedMigrations(db)).toEqual(namesThrough("2026-09-14-user-profile"));
      expect(migrate(db)).toEqual({
        adopted: false,
        applied: namesAfter("2026-09-14-user-profile"),
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
  it("adopts a numbered root while a pushed platform boots, leaving 2026-09-02-drop-goal-state for the runtime", () => {
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
      expect(r.applied).toEqual(namesAfter(null).filter((n) => n !== "2026-09-02-drop-goal-state"));
      expect(r.deferred).toEqual(["2026-09-02-drop-goal-state"]);
      expect(shape(db)).toBe(shape(fresh));
      // The runtime's next open records it, as the no-op it is here.
      expect(migrate(db)).toEqual({
        adopted: false,
        applied: ["2026-09-02-drop-goal-state"],
        deferred: [],
      });
    } finally {
      db.close();
      fresh.close();
    }
  });

  it("boots on a root whose goal_state is still there, keeping it — a contract never runs on the swap path", () => {
    const db = open024();
    try {
      const r = migrate(db, { swapPath: true });
      expect(r.deferred).toEqual(["2026-09-02-drop-goal-state"]);
      expect(r.applied).toEqual(namesAfter(null).filter((n) => n !== "2026-09-02-drop-goal-state"));
      expect(hasTable(db, "goal_state")).toBe(true);
      // A second push leaves it pending again, and still boots.
      expect(migrate(db, { swapPath: true })).toEqual({
        adopted: false,
        applied: [],
        deferred: ["2026-09-02-drop-goal-state"],
      });
      // The runtime's own open, which owns the process, applies it.
      expect(migrate(db).applied).toEqual(["2026-09-02-drop-goal-state"]);
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
      const r = rollbackTo(db, "2026-08-31-messaging-bindings");
      expect(r.reverted).toEqual(namesAfter("2026-08-31-messaging-bindings").reverse());
      expect(appliedMigrations(db)).toEqual(["2026-08-31-messaging-bindings"]);
      const cols = columns(db, "messaging_bindings");
      expect(cols).not.toContain("render_markdown");
      expect(cols).not.toContain("final_reply_only");
      expect(hasTable(db, "machines")).toBe(false);
      expect(hasTable(db, "org_channel_reads")).toBe(false);
      // goal_state, which 2026-09-02-drop-goal-state dropped, is back.
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
        namesAfter(null).filter((n) => n !== "2026-09-17-model-promotions"),
      );
      migrate(db);
      // 2026-09-17-model-promotions ran last, so it is the only one applied after the last other name.
      const lastOther = namesAfter(null)
        .filter((n) => n !== "2026-09-17-model-promotions")
        .at(-1)!;
      expect(rollbackTo(db, lastOther).reverted).toEqual(["2026-09-17-model-promotions"]);
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
      expect(() => rollbackTo(db, "2026-09-04-machines")).toThrow(/not applied/);
    } finally {
      db.close();
    }
  });
});

describe("2026-10-12-messaging-conversations on a named-migration root", () => {
  it("creates a unique row per bot and chat on the swap path, and its down drops them", () => {
    const db = openFresh();
    try {
      migrate(db);
      db.exec("DROP TABLE messaging_conversations");
      db.exec("DELETE FROM schema_migrations WHERE name = '2026-10-12-messaging-conversations'");
      // The declared predecessor of 2026-10-12-messaging-conversations: rolling back to it undoes the
      // re-applied migration (the migrations declared after it have no-op downs on this root).
      const previous = "2026-10-10-agent-api";
      const before = shape(db);
      expect(migrate(db, { swapPath: true }).applied).toEqual([
        "2026-10-12-messaging-conversations",
      ]);
      const put = () =>
        db
          .prepare(
            "INSERT INTO messaging_conversations (channel, account_id, chat_id, state_json, updated_at)" +
              " VALUES ('wechat', 'bot_1', 'user_1', '{}', '2026-10-10T00:00:00.000Z')",
          )
          .run();
      put();
      expect(put).toThrow(/UNIQUE/);
      rollbackTo(db, previous);
      expect(shape(db)).toBe(before);
    } finally {
      db.close();
    }
  });
});
