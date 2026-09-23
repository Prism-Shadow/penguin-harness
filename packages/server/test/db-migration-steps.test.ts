/**
 * What each migration changes, from the database the release or line before it left: the
 * 0.2.4 → 0.2.7 messaging tables, the goal_state drop (the one contract), the user profile's
 * columns, the channels table recreation, the queues and model tables, and the repairs for
 * roots the numbered era left behind. The ledger itself is pinned in db-migrations.test.ts.
 */
import { describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { MIGRATIONS, appliedMigrations, migrate, rollbackTo } from "../src/db/migrations/index.js";
import {
  columns,
  hasTable,
  namesAfter,
  namesThrough,
  open024,
  open029,
  openChannels,
  openDeskNotices,
  openFresh,
  openMachinesColumns,
  openOrgCaches,
  openPreProfile,
  openPromotions,
  record,
  shape,
  stampThrough,
} from "./db-migrations-fixtures.js";

describe("0.2.4 → current", () => {
  /** The whole point: an older runtime's database becomes what a current build creates. */
  it("brings a 0.2.4 database to the shape a fresh one is created with", () => {
    const old = open024();
    const fresh = openFresh();
    try {
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

describe("0.2.9 → current: drop-goal-state", () => {
  it("drops the table and its index, and a database that never had them migrates the same", () => {
    const db = open029();
    const fresh = openFresh();
    try {
      expect(migrate(db).applied).toEqual(namesAfter("messaging-delivery-flags"));
      expect(shape(db)).toBe(shape(fresh));
      // IF EXISTS: a database this build created has no goal_state to drop.
      stampThrough(fresh, "messaging-delivery-flags");
      expect(migrate(fresh).applied).toEqual(namesAfter("messaging-delivery-flags"));
    } finally {
      db.close();
      fresh.close();
    }
  });

  it("is a contract: the only migration a hot push leaves pending", () => {
    expect(MIGRATIONS.filter((m) => !m.swapSafe).map((m) => m.name)).toEqual(["drop-goal-state"]);
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
      rollbackTo(db, "messaging-delivery-flags");
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
    const fresh = openFresh();
    try {
      expect(columns(db, "users")).not.toContain("display_name");
      expect(migrate(db).applied).toEqual(namesAfter("machines"));
      expect(columns(db, "users")).toEqual(expect.arrayContaining(["display_name", "avatar"]));
      expect(shape(db)).toBe(shape(fresh));
      // The declarative track already added both on a database this build created: the
      // migration finds its work done, adds nothing twice, and is recorded anyway.
      stampThrough(fresh, "machines");
      expect(migrate(fresh).applied).toEqual(namesAfter("machines"));
      expect(columns(fresh, "users").filter((c) => c === "avatar")).toEqual(["avatar"]);
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
      rollbackTo(db, "machines");
      expect(shape(db)).toBe(before);
      expect(columns(db, "users")).not.toContain("display_name");
      // The account itself survives; only what the two columns held is gone.
      expect(db.prepare("SELECT user_id FROM users").all()).toEqual([{ user_id: "bob" }]);
    } finally {
      db.close();
    }
  });
});

describe("company-mode-org-caches → current: company-mode-channels", () => {
  it("renames both chat tables and puts channel_id in their primary keys, recreating them empty", () => {
    const db = openOrgCaches();
    const fresh = openFresh();
    try {
      db.exec(
        "INSERT INTO org_chat_reads (project_id, org_id, user_id, last_read_id)" +
          " VALUES ('p1', 'acme', 'alice', 'msg-2026-09-01-00-00-00-00000000')",
      );
      expect(shape(db)).not.toBe(shape(fresh));
      expect(migrate(db).applied).toEqual(namesAfter("company-mode-org-caches"));
      expect(shape(db)).toBe(shape(fresh));
      expect(hasTable(db, "org_chat_reads")).toBe(false);
      expect(db.prepare("SELECT COUNT(*) AS n FROM org_channel_reads").get()).toEqual({ n: 0 });
    } finally {
      db.close();
      fresh.close();
    }
  });

  it("org-caches run again after it does not bring the chat tables back", () => {
    const db = openFresh();
    try {
      migrate(db);
      MIGRATIONS.find((m) => m.name === "company-mode-org-caches")!.up(db);
      expect(hasTable(db, "org_chat_state")).toBe(false);
      expect(hasTable(db, "org_chat_reads")).toBe(false);
    } finally {
      db.close();
    }
  });

  it("down puts the old tables and the single-chat shape back, empty", () => {
    const db = openOrgCaches();
    const at = openOrgCaches();
    try {
      migrate(db);
      rollbackTo(db, "company-mode-org-caches");
      expect(appliedMigrations(db).at(-1)).toBe("company-mode-org-caches");
      expect(shape(db)).toBe(shape(at));
      expect(db.prepare("SELECT COUNT(*) AS n FROM org_chat_state").get()).toEqual({ n: 0 });
    } finally {
      db.close();
      at.close();
    }
  });
});

describe("company-mode-channels → current: company-mode-desk-notices", () => {
  it("adds the queue a ticket change is delivered through, writable and indexed", () => {
    const db = openChannels();
    const fresh = openFresh();
    try {
      expect(migrate(db).applied).toEqual(namesAfter("company-mode-channels"));
      expect(shape(db)).toBe(shape(fresh));
      db.exec(
        "INSERT INTO org_desk_notices (project_id, org_id, agent_id, ticket_id, change, at)" +
          " VALUES ('p1', 'acme', 'acme_hr', '2026-09-08-site', 'assigned', '2026-09-08T01:00:00Z')",
      );
      expect(db.prepare("SELECT seq FROM org_desk_notices").all()).toEqual([{ seq: 1 }]);
    } finally {
      db.close();
      fresh.close();
    }
  });

  it("down drops the queue with the notices nobody has been told about yet", () => {
    const db = openChannels();
    const at = openChannels();
    try {
      migrate(db);
      rollbackTo(db, "company-mode-channels");
      expect(shape(db)).toBe(shape(at));
    } finally {
      db.close();
      at.close();
    }
  });
});

describe("company-mode-desk-notices → current: model-promotions and model-provider-auth-tokens", () => {
  it("creates both model tables, on the swap path too, and their downs drop them again", () => {
    const db = openDeskNotices();
    try {
      expect(migrate(db, { swapPath: true }).applied).toEqual(
        namesAfter("company-mode-desk-notices"),
      );
      expect(hasTable(db, "model_promotions")).toBe(true);
      expect(hasTable(db, "model_provider_auth_tokens")).toBe(true);
      rollbackTo(db, "company-mode-desk-notices");
      expect(hasTable(db, "model_promotions")).toBe(false);
      expect(hasTable(db, "model_provider_auth_tokens")).toBe(false);
    } finally {
      db.close();
    }
  });

  it("the refresh-token table is writable", () => {
    const db = openPromotions();
    try {
      expect(migrate(db).applied).toEqual(namesAfter("model-promotions"));
      db.exec(`
        INSERT INTO users (user_id, password_hash, is_admin, created_at) VALUES ('owner', 'hash', 1, '2026-09-20T00:00:00.000Z');
        INSERT INTO projects (project_id, owner_user_id, created_at) VALUES ('p1', 'owner', '2026-09-20T00:00:00.000Z');
        INSERT INTO model_provider_auth_tokens (project_id, provider, refresh_token, access_token_expires_at, updated_at)
          VALUES ('p1', 'modelscope', 'refresh', '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z');
      `);
      expect(db.prepare("SELECT refresh_token FROM model_provider_auth_tokens").all()).toEqual([
        { refresh_token: "refresh" },
      ]);
    } finally {
      db.close();
    }
  });
});

describe("a machines table from before the machines migration: machines-columns", () => {
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

  it("is kept as it stands by machines, and gains the columns the row writes", () => {
    const db = open029();
    try {
      db.exec(ADOPTED_MACHINES_DDL);
      // open029 records through messaging-delivery-flags; the goal drop ran too.
      record(db, ["drop-goal-state"]);
      expect(migrate(db).applied).toEqual(namesAfter("drop-goal-state"));
      expect(columns(db, "machines")).toEqual(expect.arrayContaining(["session_pid", "platform"]));
      db.prepare(
        "INSERT INTO machines (address, machine_id, version, installed_at, session_pid, remote_port, platform) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run("ssh:nas", null, "9.9.9", "2026-09-04T00:00:00.000Z", 42, 7364, "linux");
      expect(migrate(db).applied).toEqual([]);
    } finally {
      db.close();
    }
  });
});

describe("machines-columns → current: browser-extensions", () => {
  it("creates the pairings table, which holds one row per token and cascades with its user", () => {
    const db = openMachinesColumns();
    try {
      expect(migrate(db, { swapPath: true }).applied).toEqual([
        "browser-extensions",
        "agent-api",
        "port-forwards",
        "port-forwards-adoption",
        "port-forwards-direction",
        "model-tables-adoption",
        "messaging-conversations",
      ]);
      db.exec("PRAGMA foreign_keys = ON");
      db.exec(
        "INSERT INTO users (user_id, password_hash, is_admin, created_at)" +
          " VALUES ('alice', 'hash', 0, '2026-10-02T00:00:00.000Z')",
      );
      const insert = (id: string, hash: string) =>
        db
          .prepare(
            "INSERT INTO browser_extensions (extension_id, user_id, token_hash, name, version, created_at)" +
              " VALUES (?, 'alice', ?, 'Chrome 130 on Linux', '0.2.13', '2026-10-02T00:00:00.000Z')",
          )
          .run(id, hash);
      insert("e1", "h1");
      // A token hash names one pairing.
      expect(() => insert("e2", "h1")).toThrow(/UNIQUE/);
      db.exec("DELETE FROM users WHERE user_id = 'alice'");
      expect(db.prepare("SELECT COUNT(*) AS n FROM browser_extensions").get()).toEqual({ n: 0 });
    } finally {
      db.close();
    }
  });

  it("down drops the pairings, and a second up recreates the table empty", () => {
    const db = openMachinesColumns();
    try {
      migrate(db);
      rollbackTo(db, "machines-columns");
      expect(appliedMigrations(db).at(-1)).toBe("machines-columns");
      expect(hasTable(db, "browser_extensions")).toBe(false);
      migrate(db);
      expect(hasTable(db, "browser_extensions")).toBe(true);
    } finally {
      db.close();
    }
  });
});

describe("numbered roots other lines stamped: adopted whole", () => {
  it("a root the closed #797 line stamped 13 gets port_forwards back, on the swap path", () => {
    const db = openFresh();
    try {
      db.exec("DROP TABLE port_forwards; PRAGMA user_version = 13;");
      expect(() => db.prepare("SELECT * FROM port_forwards").all()).toThrow(/no such table/);
      migrate(db, { swapPath: true });
      expect(db.prepare("SELECT * FROM port_forwards").all()).toEqual([]);
      expect(columns(db, "port_forwards")).toContain("direction");
    } finally {
      db.close();
    }
  });

  it("a root the chain stamped 16 before its restack gets both model tables back, on the swap path", () => {
    const db = openFresh();
    try {
      db.exec(
        "DROP TABLE model_promotions; DROP TABLE model_provider_auth_tokens; PRAGMA user_version = 16;",
      );
      migrate(db, { swapPath: true });
      expect(db.prepare("SELECT * FROM model_promotions").all()).toEqual([]);
      expect(db.prepare("SELECT * FROM model_provider_auth_tokens").all()).toEqual([]);
    } finally {
      db.close();
    }
  });
});

/** A root the ledger last saw before the main line's three: the columns are SCHEMA_SQL's, undone. */
function openPreSessionsKeptAt(): DatabaseSync {
  const db = openFresh();
  db.exec("ALTER TABLE sessions DROP COLUMN kept_at");
  for (const column of ["provider", "model_id", "thinking_level", "workspace", "max_concurrent_runs"]) {
    db.exec(`ALTER TABLE agent_api DROP COLUMN ${column}`);
  }
  record(db, namesThrough("messaging-conversations"));
  return db;
}

describe("messaging-conversations → current: sessions-kept-at and the Agent API's later columns", () => {
  const insertSession = (db: DatabaseSync) =>
    db.exec(
      "INSERT INTO sessions (session_id, project_id, agent_id, provider, model_id, workspace, created_at)" +
        " VALUES ('s1', 'p1', 'coder', 'openai', 'gpt', '/w', '2026-10-11T00:00:00.000Z')",
    );

  it("adds the mark and the unset defaults while a pushed platform boots, leaving every existing row as it stands", () => {
    const db = openPreSessionsKeptAt();
    try {
      insertSession(db);
      expect(migrate(db, { swapPath: true }).applied).toEqual([
        "sessions-kept-at",
        "agent-api-session-settings",
        "agent-api-concurrency",
      ]);
      expect(db.prepare("SELECT session_id, kept_at FROM sessions").all()).toEqual([
        { session_id: "s1", kept_at: null },
      ]);
    } finally {
      db.close();
    }
  });

  it("down keeps the mark and the column it lives in, so a kept Session stays kept", () => {
    const db = openPreSessionsKeptAt();
    try {
      insertSession(db);
      migrate(db);
      db.exec("UPDATE sessions SET kept_at = '2026-10-11T01:00:00.000Z'");
      rollbackTo(db, "sessions-kept-at");
      expect(columns(db, "sessions")).toContain("kept_at");
      expect(db.prepare("SELECT kept_at FROM sessions").get()).toEqual({
        kept_at: "2026-10-11T01:00:00.000Z",
      });
    } finally {
      db.close();
    }
  });
});

/**
 * The first form of `port_forwards`: what port-forwards created on the roots that ran it
 * before its DDL was changed in place, and what port-forwards-adoption creates on a root
 * without the table — no direction, one local port per forward.
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
  /** A root that ran port-forwards in its first form and has a forward saved. */
  function openFirstForm(): DatabaseSync {
    const db = openFresh();
    db.exec("DROP INDEX IF EXISTS idx_port_forwards_local_in; DROP TABLE port_forwards;");
    db.exec(PORT_FORWARDS_V1_DDL);
    db.prepare(
      "INSERT INTO port_forwards (id, machine_id, workspace, remote_port, local_port, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("f1", "m1", "/home/dev/site", 3000, 3000, "2026-09-21T00:00:00.000Z");
    stampThrough(db, "port-forwards-adoption");
    return db;
  }
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
      expect(columns(db, "port_forwards")).toContain("direction");
      expect(db.prepare("SELECT id, direction, local_port FROM port_forwards").all()).toEqual([
        { id: "f1", direction: "in", local_port: 3000 },
      ]);
      insertNew(db, "f2", "/home/dev/site", "out", 5432, 3000);
      // What a predecessor rolled back to would still write: no direction named.
      insertOld(db, "f3", "/home/dev/other", 8080, 8080);
      expect(db.prepare("SELECT direction FROM port_forwards WHERE id = 'f3'").get()).toEqual({
        direction: "in",
      });
      expect(() => insertOld(db, "f4", "/home/dev/third", 9000, 3000)).toThrow(/UNIQUE/);
    } finally {
      db.close();
    }
  });

  it("brings a table port-forwards-adoption created — the same first form — to the current shape too", () => {
    const db = openFresh();
    try {
      db.exec("DROP TABLE port_forwards");
      stampThrough(db, "port-forwards");
      migrate(db, { swapPath: true });
      expect(columns(db, "port_forwards")).toContain("direction");
      insertNew(db, "f1", "/home/dev/site", "out", 5432, 5432);
    } finally {
      db.close();
    }
  });

  it("leaves a table that already has the column alone", () => {
    const db = openFresh();
    try {
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
      expect(columns(db, "port_forwards")).not.toContain("direction");
      expect(db.prepare("SELECT id FROM port_forwards").all()).toEqual([{ id: "f1" }]);
    } finally {
      db.close();
    }
  });
});
