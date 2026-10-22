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

describe("0.2.9 → current: 2026-09-02-drop-goal-state", () => {
  it("drops the table and its index, and a database that never had them migrates the same", () => {
    const db = open029();
    const fresh = openFresh();
    try {
      expect(migrate(db).applied).toEqual(namesAfter("2026-08-31-messaging-delivery-flags"));
      expect(shape(db)).toBe(shape(fresh));
      // IF EXISTS: a database this build created has no goal_state to drop.
      stampThrough(fresh, "2026-08-31-messaging-delivery-flags");
      expect(migrate(fresh).applied).toEqual(namesAfter("2026-08-31-messaging-delivery-flags"));
    } finally {
      db.close();
      fresh.close();
    }
  });

  it("is a contract: the only migration a hot push leaves pending", () => {
    expect(MIGRATIONS.filter((m) => !m.swapSafe).map((m) => m.name)).toEqual([
      "2026-09-02-drop-goal-state",
    ]);
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
      rollbackTo(db, "2026-08-31-messaging-delivery-flags");
      expect(shape(db)).toBe(before);
      expect(db.prepare("SELECT COUNT(*) AS n FROM goal_state").get()).toEqual({ n: 0 });
    } finally {
      db.close();
    }
  });
});

describe("pre-profile → current: 2026-09-14-user-profile", () => {
  it("adds both columns, and a database that already has them migrates the same", () => {
    const db = openPreProfile();
    const fresh = openFresh();
    try {
      expect(columns(db, "users")).not.toContain("display_name");
      expect(migrate(db).applied).toEqual(namesAfter("2026-09-04-machines"));
      expect(columns(db, "users")).toEqual(expect.arrayContaining(["display_name", "avatar"]));
      expect(shape(db)).toBe(shape(fresh));
      // The declarative track already added both on a database this build created: the
      // migration finds its work done, adds nothing twice, and is recorded anyway.
      stampThrough(fresh, "2026-09-04-machines");
      expect(migrate(fresh).applied).toEqual(namesAfter("2026-09-04-machines"));
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
      rollbackTo(db, "2026-09-04-machines");
      expect(shape(db)).toBe(before);
      expect(columns(db, "users")).not.toContain("display_name");
      // The account itself survives; only what the two columns held is gone.
      expect(db.prepare("SELECT user_id FROM users").all()).toEqual([{ user_id: "bob" }]);
    } finally {
      db.close();
    }
  });
});

describe("2026-09-16-company-mode-org-caches → current: 2026-09-16-company-mode-channels", () => {
  it("renames both chat tables and puts channel_id in their primary keys, recreating them empty", () => {
    const db = openOrgCaches();
    const fresh = openFresh();
    try {
      db.exec(
        "INSERT INTO org_chat_reads (project_id, org_id, user_id, last_read_id)" +
          " VALUES ('p1', 'acme', 'alice', 'msg-2026-09-01-00-00-00-00000000')",
      );
      expect(shape(db)).not.toBe(shape(fresh));
      expect(migrate(db).applied).toEqual(namesAfter("2026-09-16-company-mode-org-caches"));
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
      MIGRATIONS.find((m) => m.name === "2026-09-16-company-mode-org-caches")!.up(db);
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
      rollbackTo(db, "2026-09-16-company-mode-org-caches");
      expect(appliedMigrations(db).at(-1)).toBe("2026-09-16-company-mode-org-caches");
      expect(shape(db)).toBe(shape(at));
      expect(db.prepare("SELECT COUNT(*) AS n FROM org_chat_state").get()).toEqual({ n: 0 });
    } finally {
      db.close();
      at.close();
    }
  });
});

describe("2026-09-16-company-mode-channels → current: 2026-09-16-company-mode-desk-notices", () => {
  it("adds the queue a ticket change is delivered through, writable and indexed", () => {
    const db = openChannels();
    const fresh = openFresh();
    try {
      expect(migrate(db).applied).toEqual(namesAfter("2026-09-16-company-mode-channels"));
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
      rollbackTo(db, "2026-09-16-company-mode-channels");
      expect(shape(db)).toBe(shape(at));
    } finally {
      db.close();
      at.close();
    }
  });
});

describe("2026-09-16-company-mode-desk-notices → current: 2026-09-17-model-promotions and 2026-09-21-model-provider-auth-tokens", () => {
  it("creates both model tables, on the swap path too, and their downs drop them again", () => {
    const db = openDeskNotices();
    try {
      expect(migrate(db, { swapPath: true }).applied).toEqual(
        namesAfter("2026-09-16-company-mode-desk-notices"),
      );
      expect(hasTable(db, "model_promotions")).toBe(true);
      expect(hasTable(db, "model_provider_auth_tokens")).toBe(true);
      rollbackTo(db, "2026-09-16-company-mode-desk-notices");
      expect(hasTable(db, "model_promotions")).toBe(false);
      expect(hasTable(db, "model_provider_auth_tokens")).toBe(false);
    } finally {
      db.close();
    }
  });

  it("the refresh-token table is writable", () => {
    const db = openPromotions();
    try {
      expect(migrate(db).applied).toEqual(namesAfter("2026-09-17-model-promotions"));
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

describe("a machines table from before the 2026-09-04-machines migration: 2026-09-23-machines-columns", () => {
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
      // open029 records through 2026-08-31-messaging-delivery-flags; the goal drop ran too.
      record(db, ["2026-09-02-drop-goal-state"]);
      expect(migrate(db).applied).toEqual(namesAfter("2026-09-02-drop-goal-state"));
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

describe("2026-09-23-machines-columns → current: 2026-10-04-browser-extensions", () => {
  it("creates the pairings table, which holds one row per token and cascades with its user", () => {
    const db = openMachinesColumns();
    try {
      expect(migrate(db, { swapPath: true }).applied).toEqual([
        "2026-10-04-browser-extensions",
        "2026-10-10-agent-api",
        "2026-10-12-messaging-conversations",
        "2026-10-12-sessions-kept-at",
        "2026-10-14-agent-api-session-settings",
        "2026-10-14-agent-api-concurrency",
        "2026-10-16-machines-adopted-at",
        "2026-09-23-model-tables-adoption",
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
      rollbackTo(db, "2026-09-23-machines-columns");
      expect(appliedMigrations(db).at(-1)).toBe("2026-09-23-machines-columns");
      expect(hasTable(db, "browser_extensions")).toBe(false);
      migrate(db);
      expect(hasTable(db, "browser_extensions")).toBe(true);
    } finally {
      db.close();
    }
  });
});

describe("a sessions table from before the sidebar mark: 2026-10-12-sessions-kept-at", () => {
  /** A root through 2026-10-12-messaging-conversations whose sessions table has no `kept_at` column. */
  function openPreKeptAt(): DatabaseSync {
    const db = openFresh();
    db.exec("ALTER TABLE sessions DROP COLUMN kept_at");
    stampThrough(db, "2026-10-12-messaging-conversations");
    return db;
  }

  const insertSession = (db: DatabaseSync) =>
    db.exec(
      "INSERT INTO sessions (session_id, project_id, agent_id, provider, model_id, workspace, created_at)" +
        " VALUES ('s1', 'p1', 'coder', 'openai', 'gpt', '/w', '2026-10-11T00:00:00.000Z')",
    );

  it("adds the mark while a pushed platform boots, leaving every existing Session unmarked", () => {
    const db = openPreKeptAt();
    try {
      insertSession(db);
      expect(migrate(db, { swapPath: true }).applied).toEqual([
        "2026-10-12-sessions-kept-at",
        "2026-10-14-agent-api-session-settings",
        "2026-10-14-agent-api-concurrency",
        "2026-10-16-machines-adopted-at",
        "2026-09-23-model-tables-adoption",
      ]);
      expect(db.prepare("SELECT session_id, kept_at FROM sessions").all()).toEqual([
        { session_id: "s1", kept_at: null },
      ]);
    } finally {
      db.close();
    }
  });

  it("down keeps the column and the marks in it, so a kept Session stays kept", () => {
    const db = openPreKeptAt();
    try {
      insertSession(db);
      migrate(db);
      db.exec("UPDATE sessions SET kept_at = '2026-10-11T01:00:00.000Z'");
      rollbackTo(db, "2026-10-12-messaging-conversations");
      expect(db.prepare("SELECT kept_at FROM sessions").get()).toEqual({
        kept_at: "2026-10-11T01:00:00.000Z",
      });
    } finally {
      db.close();
    }
  });
});

describe("an agent_api table from before the session settings: 2026-10-14-agent-api-session-settings", () => {
  /** A root whose line declared everything through 2026-10-12-sessions-kept-at, but not the four steps that followed it. */
  function openPreSessionSettings(): DatabaseSync {
    const db = openFresh();
    for (const column of [
      "provider",
      "model_id",
      "thinking_level",
      "workspace",
      "max_concurrent_runs",
    ]) {
      db.exec(`ALTER TABLE agent_api DROP COLUMN ${column}`);
    }
    stampThrough(db, "2026-10-12-sessions-kept-at");
    return db;
  }

  it("preserves exposure, approvals and keys while adding defaults, and keeps later choices on re-open", () => {
    const db = openPreSessionSettings();
    try {
      db.exec(
        "INSERT INTO users (user_id, password_hash, is_admin, created_at) VALUES ('owner', 'hash', 0, 'now')",
      );
      db.exec("INSERT INTO agent_api VALUES ('p', 'a', 1, 1, 'read-only', 'now')");
      db.exec(
        "INSERT INTO agent_api_keys VALUES ('key', 'p', 'a', 'hash', 'prefix', 'ci', 'owner', 'now', NULL)",
      );
      expect(migrate(db, { swapPath: true }).applied).toEqual([
        "2026-10-14-agent-api-session-settings",
        "2026-10-14-agent-api-concurrency",
        "2026-10-16-machines-adopted-at",
        "2026-09-23-model-tables-adoption",
      ]);
      expect(db.prepare("SELECT * FROM agent_api").get()).toMatchObject({
        enabled: 1,
        open: 1,
        approval_mode: "read-only",
        provider: null,
        model_id: null,
        thinking_level: null,
        workspace: null,
        max_concurrent_runs: 4,
      });
      expect(db.prepare("SELECT token_hash FROM agent_api_keys").get()).toEqual({
        token_hash: "hash",
      });
      db.exec(
        "UPDATE agent_api SET provider = 'custom', model_id = 'chosen', thinking_level = 'high', workspace = '/work'",
      );
      migrate(db);
      expect(
        db.prepare("SELECT provider, model_id, thinking_level, workspace FROM agent_api").get(),
      ).toEqual({
        provider: "custom",
        model_id: "chosen",
        thinking_level: "high",
        workspace: "/work",
      });
    } finally {
      db.close();
    }
  });
});

// Given a database that already has session settings, the concurrency upgrade preserves them
// and its key, starts with the old limit, and retains a changed limit across repeated startup.
describe("an agent_api table from before the concurrency limit: 2026-10-14-agent-api-concurrency", () => {
  /** A root whose line declared 2026-10-14-agent-api-session-settings, but not the three steps that followed it. */
  function openPreConcurrency(): DatabaseSync {
    const db = openFresh();
    db.exec("ALTER TABLE agent_api DROP COLUMN max_concurrent_runs");
    stampThrough(db, "2026-10-14-agent-api-session-settings");
    return db;
  }

  it("preserves session settings and keys while adding the concurrency limit", () => {
    const db = openPreConcurrency();
    try {
      db.exec(
        "INSERT INTO users (user_id, password_hash, is_admin, created_at) VALUES ('owner', 'hash', 0, 'now')",
      );
      db.exec(
        "INSERT INTO agent_api (project_id, agent_id, enabled, open, approval_mode, provider, model_id, thinking_level, workspace, updated_at)" +
          " VALUES ('p', 'a', 1, 1, 'read-only', 'custom', 'chosen', 'high', '/work', 'now')",
      );
      db.exec(
        "INSERT INTO agent_api_keys VALUES ('key', 'p', 'a', 'hash', 'prefix', 'ci', 'owner', 'now', NULL)",
      );
      expect(migrate(db, { swapPath: true }).applied).toEqual([
        "2026-10-14-agent-api-concurrency",
        "2026-10-16-machines-adopted-at",
        "2026-09-23-model-tables-adoption",
      ]);
      expect(db.prepare("SELECT * FROM agent_api").get()).toMatchObject({
        enabled: 1,
        open: 1,
        approval_mode: "read-only",
        provider: "custom",
        model_id: "chosen",
        thinking_level: "high",
        workspace: "/work",
        max_concurrent_runs: 4,
      });
      expect(db.prepare("SELECT token_hash FROM agent_api_keys").get()).toEqual({
        token_hash: "hash",
      });
      db.exec("UPDATE agent_api SET max_concurrent_runs = 9");
      migrate(db);
      expect(db.prepare("SELECT max_concurrent_runs FROM agent_api").get()).toEqual({
        max_concurrent_runs: 9,
      });
    } finally {
      db.close();
    }
  });
});

// Given a database that already has the concurrency limit, the adoption-time upgrade leaves
// machines adopted before it without a time, and keeps a written time on rollback.
describe("a machines table from before the adoption times: 2026-10-16-machines-adopted-at", () => {
  /** A root whose line declared 2026-10-14-agent-api-concurrency, but not the two steps that followed it. */
  function openPreAdoption(): DatabaseSync {
    const db = openFresh();
    db.exec("ALTER TABLE machines DROP COLUMN adopted_at");
    stampThrough(db, "2026-10-14-agent-api-concurrency");
    return db;
  }

  const insertMachine = (db: DatabaseSync) =>
    db.exec(
      "INSERT INTO machines (address, machine_id, version, installed_at) VALUES ('ssh:nas', 'm1', '0.2.16', '2026-10-14T00:00:00.000Z')",
    );

  it("adds the adoption time while a pushed platform boots, leaving a machine adopted before it without one", () => {
    const db = openPreAdoption();
    try {
      insertMachine(db);
      expect(migrate(db, { swapPath: true }).applied).toEqual([
        "2026-10-16-machines-adopted-at",
        "2026-09-23-model-tables-adoption",
      ]);
      expect(db.prepare("SELECT address, adopted_at FROM machines").all()).toEqual([
        { address: "ssh:nas", adopted_at: null },
      ]);
    } finally {
      db.close();
    }
  });

  it("down keeps the column and the times in it", () => {
    const db = openPreAdoption();
    try {
      insertMachine(db);
      migrate(db);
      db.exec("UPDATE machines SET adopted_at = '2026-10-15T00:00:00.000Z'");
      rollbackTo(db, "2026-10-14-agent-api-concurrency");
      expect(db.prepare("SELECT adopted_at FROM machines").get()).toEqual({
        adopted_at: "2026-10-15T00:00:00.000Z",
      });
    } finally {
      db.close();
    }
  });
});

describe("numbered roots other lines stamped: adopted whole", () => {
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
