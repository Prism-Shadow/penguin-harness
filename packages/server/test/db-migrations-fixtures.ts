/**
 * Databases as earlier releases and lines left them, and the comparison the migration suites
 * judge them by. Shared by db-migrations.test.ts (the ledger) and db-migration-steps.test.ts
 * (each migration's own change).
 */
import type { DatabaseSync } from "node:sqlite";
import { MIGRATIONS } from "../src/db/migrations/index.js";
import { SCHEMA_SQL } from "../src/db/schema.js";

export const sqlite = process.getBuiltinModule("node:sqlite");

/**
 * The ledger as every build with one creates it. Spelled out rather than imported: it is an
 * on-disk contract an older build reads, and a fixture that followed a changed declaration
 * would hide the break.
 */
const LEDGER_DDL =
  "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)";

/** Records `names` in the ledger, in that order, as if they had run. */
export function record(db: DatabaseSync, names: readonly string[]): void {
  db.exec(LEDGER_DDL);
  const insert = db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)");
  for (const name of names) insert.run(name, "2026-10-01T00:00:00.000Z");
}

/** Every declared migration up to and including `name`, in declaration order. */
export function namesThrough(name: string): string[] {
  const at = MIGRATIONS.findIndex((m) => m.name === name);
  if (at < 0) throw new Error(`no migration named ${name}`);
  return MIGRATIONS.slice(0, at + 1).map((m) => m.name);
}

/** Every declared migration after `name` (`null`: all of them): what a root through `name` takes. */
export function namesAfter(name: string | null): string[] {
  if (name === null) return MIGRATIONS.map((m) => m.name);
  return MIGRATIONS.slice(namesThrough(name).length).map((m) => m.name);
}

/** A ledger recording every migration through `name`: a root that has run exactly those. */
export function stampThrough(db: DatabaseSync, name: string): void {
  record(db, namesThrough(name));
}

/**
 * The goal_state table as every release from 0.1.3 to 0.2.9 declared it (frozen: the live
 * schema no longer has it, and the migration that drops it must not learn a new shape).
 */
export const GOAL_STATE_DDL = `
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
export function dropCompanyTables(db: DatabaseSync): void {
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

/** browser-extensions' table and index: a database from before the Chrome pairings had neither. */
export function dropBrowserExtensions(db: DatabaseSync): void {
  db.exec("DROP INDEX IF EXISTS idx_browser_extensions_user");
  db.exec("DROP TABLE IF EXISTS browser_extensions");
}

/** Takes user-profile's two columns off a database built from the current declaration. */
export function dropProfileColumns(db: DatabaseSync): void {
  db.exec("ALTER TABLE users DROP COLUMN avatar");
  db.exec("ALTER TABLE users DROP COLUMN display_name");
}

/**
 * Takes port-forwards' table off a database built from the current declaration. Every fixture
 * standing for a database OLDER than port forwarding needs it: a round trip that rolls back
 * through port-forwards drops the table, and would otherwise land on less than it began with.
 */
export function dropPortForwards(db: DatabaseSync): void {
  db.exec("DROP INDEX IF EXISTS idx_port_forwards_machine; DROP TABLE IF EXISTS port_forwards;");
}

/** The current declaration: what a fresh database is created with. */
export function openFresh(): DatabaseSync {
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec(SCHEMA_SQL);
  return db;
}

/**
 * The v0.2.4 schema, as a frozen excerpt: today's declaration minus exactly what 0.2.4
 * lacked, plus the one table it had that today's declaration dropped. Derived from
 * SCHEMA_SQL, not by hand-copying tables that would fork from reality. No ledger and no
 * stamp: it predates both.
 */
export function open024(): DatabaseSync {
  const db = openFresh();
  dropPortForwards(db);
  db.exec("DROP TABLE IF EXISTS model_provider_auth_tokens");
  dropBrowserExtensions(db);
  db.exec("DROP TABLE IF EXISTS model_promotions");
  dropCompanyTables(db);
  db.exec("DROP TABLE messaging_bindings");
  db.exec("DROP INDEX IF EXISTS idx_auth_sessions_expires");
  db.exec("DROP INDEX IF EXISTS idx_auth_sessions_user");
  dropProfileColumns(db);
  db.exec(GOAL_STATE_DDL);
  return db;
}

/** A 0.2.9 database: 0.2.4 plus messaging, still goal_state; through messaging-delivery-flags. */
export function open029(): DatabaseSync {
  const db = openFresh();
  dropPortForwards(db);
  db.exec("DROP TABLE IF EXISTS model_provider_auth_tokens");
  dropBrowserExtensions(db);
  db.exec("DROP TABLE IF EXISTS model_promotions");
  dropCompanyTables(db);
  db.exec(GOAL_STATE_DDL);
  // No machines tables (the machines migration adds them) and no profile columns.
  db.exec("DROP TABLE machine_project; DROP TABLE machines; DROP TABLE machine;");
  dropProfileColumns(db);
  stampThrough(db, "messaging-delivery-flags");
  return db;
}

/** A database from before the user profile: through `machines`, no company mode yet. */
export function openPreProfile(): DatabaseSync {
  const db = openFresh();
  dropPortForwards(db);
  db.exec("DROP TABLE IF EXISTS model_provider_auth_tokens");
  dropBrowserExtensions(db);
  db.exec("DROP TABLE IF EXISTS model_promotions");
  dropProfileColumns(db);
  dropCompanyTables(db);
  stampThrough(db, "machines");
  return db;
}

/**
 * The two chat tables as company-mode-org-caches declared them (frozen: chat became channels
 * — renamed tables, `channel_id` in the primary keys — and the migration that recreates them
 * must not learn a new shape).
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

/** Through company-mode-org-caches: company mode's caches, before chat became channels. */
export function openOrgCaches(): DatabaseSync {
  const db = openFresh();
  dropPortForwards(db);
  db.exec("DROP TABLE IF EXISTS model_provider_auth_tokens");
  dropBrowserExtensions(db);
  db.exec("DROP TABLE IF EXISTS model_promotions");
  db.exec(PRE_CHANNEL_CHAT_DDL);
  db.exec("DROP TABLE IF EXISTS org_desk_notices");
  stampThrough(db, "company-mode-org-caches");
  return db;
}

/** Through company-mode-channels: channels, and no desk-notice queue yet. */
export function openChannels(): DatabaseSync {
  const db = openFresh();
  dropPortForwards(db);
  db.exec("DROP TABLE IF EXISTS org_desk_notices");
  db.exec("DROP TABLE IF EXISTS model_provider_auth_tokens");
  dropBrowserExtensions(db);
  db.exec("DROP TABLE IF EXISTS model_promotions");
  stampThrough(db, "company-mode-channels");
  return db;
}

/** Through company-mode-desk-notices: the promotions table does not exist yet. */
export function openDeskNotices(): DatabaseSync {
  const db = openFresh();
  dropPortForwards(db);
  db.exec("DROP TABLE IF EXISTS model_provider_auth_tokens");
  dropBrowserExtensions(db);
  db.exec("DROP TABLE IF EXISTS model_promotions");
  stampThrough(db, "company-mode-desk-notices");
  return db;
}

/** Through model-promotions: provider auth refresh tokens do not exist yet. */
export function openPromotions(): DatabaseSync {
  const db = openFresh();
  dropPortForwards(db);
  db.exec("DROP TABLE IF EXISTS model_provider_auth_tokens");
  dropBrowserExtensions(db);
  stampThrough(db, "model-promotions");
  return db;
}

/** Through machines-columns: everything before the Chrome pairings. */
export function openMachinesColumns(): DatabaseSync {
  const db = openFresh();
  dropPortForwards(db);
  dropBrowserExtensions(db);
  stampThrough(db, "machines-columns");
  return db;
}

/** Column names of `table`. */
export function columns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

/** Whether a table named `name` exists. */
export function hasTable(db: DatabaseSync, name: string): boolean {
  return (
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !==
    undefined
  );
}

/**
 * Every schema object, in a form two databases can be compared by — columns keyed by NAME,
 * with ordinal position (`cid`) excluded, and the ledger left out (it records history, not
 * shape).
 *
 * Column ORDER is deliberately not compared. `ALTER TABLE ADD COLUMN` appends, while a
 * fresh database gets the column wherever SCHEMA_SQL declares it; every read here maps rows
 * by name. Index column order IS compared: for a composite index it is the index.
 */
export function shape(db: DatabaseSync): string {
  const objs = db
    .prepare(
      "SELECT type, name, tbl_name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND tbl_name != 'schema_migrations' ORDER BY type, name",
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

/** Every row of every table but the ledger, so a re-run that lost or changed data shows. */
export function contents(db: DatabaseSync): string {
  const tables = (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations' ORDER BY name",
      )
      .all() as { name: string }[]
  ).map((t) => t.name);
  return JSON.stringify(
    tables.map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]),
  );
}
