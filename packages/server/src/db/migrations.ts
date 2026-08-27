/**
 * Ordered, versioned schema migrations.
 *
 * `schema.ts` declares the shape a FRESH database is created with. It cannot express a
 * CHANGE — `CREATE TABLE IF NOT EXISTS` only ever says "should exist", so re-running it
 * converges a database toward the current declaration without ever knowing, or recording,
 * which state it came from. That is why a build could not tell a 0.2.4 database from a
 * 0.2.7 one, and why the only safe change was an additive one.
 *
 * A migration says what CHANGED, runs once, and leaves the database stamped with how far
 * it has come (`PRAGMA user_version`). Two rules make that stamp trustworthy:
 *
 * FROZEN DDL. A migration spells out its own SQL and never imports SCHEMA_SQL. Referring
 * to the live declaration would make an old migration silently mean something new every
 * time the schema moves, which is the property that makes migrations auditable at all.
 *
 * ONE WAY, IN ORDER. Versions are contiguous from 1 and never renumbered or rewritten
 * once released — a database that already stamped version N will never run N again, so
 * editing N only changes what NEW databases get, and silently forks the two.
 *
 * `swapSafe` is this codebase's extra axis, and it exists because of hot updates. A
 * pushed platform boots against a live database and is ROLLED BACK to its predecessor if
 * it fails; the predecessor then runs on whatever the migration already did. Additive
 * work survives that (the older build does not know the new table, so it never touches
 * it) — narrowing work does not. Anything that drops, retypes, constrains, or reshapes
 * is `swapSafe: false` and must be refused on the swap path rather than half-applied
 * (see `migrate`'s `swapPath` option).
 *
 * ADOPTION. Databases created before this file existed are all stamped 0 while sitting in
 * genuinely different shapes, so a migration must tolerate finding its work already done.
 * That is not only a version-1 concern: `schema.ts` still DECLARES the current shape in
 * full and `openDatabase` still runs its ensureColumn list, so a database can arrive at a
 * migration with that migration's work already applied by the declarative track. Until
 * SCHEMA_SQL is frozen to a baseline and every later change is a migration, every
 * migration here stays idempotent — `IF NOT EXISTS`, or the same `ensureColumn` guard the
 * declarative track uses. Once that double track is gone, a bare `CREATE TABLE` that
 * fails loudly becomes the point.
 */
import type { DatabaseSync } from "node:sqlite";
import { ensureColumn } from "./database.js";

export interface Migration {
  /** Contiguous from 1. Never renumbered, never edited once released. */
  version: number;
  /** Kebab-case, names the change — read in logs and in the stamp's history. */
  name: string;
  /**
   * May this run while a pushed platform boots? True only for strictly additive work,
   * which a rollback to the previous platform survives. See the module doc.
   */
  swapSafe: boolean;
  /** Applied inside a transaction; throw to abort and leave the version unchanged. */
  up: (db: DatabaseSync) => void;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "messaging-bindings",
    // Purely additive: one new table plus three indexes, no column of any existing table
    // touched. A platform that rolls back to a predecessor without messaging simply never
    // queries them.
    swapSafe: true,
    up(db) {
      // 0.2.4 → 0.2.7. Frozen copy of the DDL as of 0.2.7; do not re-derive from schema.ts.
      // IF NOT EXISTS only because version 1 adopts unstamped databases, which may already
      // be at 0.2.7 (see the module doc's ADOPTION note).
      db.exec(`
        CREATE TABLE IF NOT EXISTS messaging_bindings (
          session_id       TEXT NOT NULL,
          channel          TEXT NOT NULL,
          account_id       TEXT NOT NULL,
          config_json      TEXT NOT NULL,
          enabled          INTEGER NOT NULL DEFAULT 0,
          line_per_message INTEGER NOT NULL DEFAULT 0,
          last_chat_id     TEXT,
          last_chat_is_direct INTEGER NOT NULL DEFAULT 1,
          last_inbound_message_id TEXT,
          created_at       TEXT NOT NULL,
          updated_at       TEXT NOT NULL,
          PRIMARY KEY (session_id, channel)
        );
        CREATE INDEX IF NOT EXISTS idx_messaging_by_account ON messaging_bindings(channel, account_id);
        CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);
        CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
      `);
    },
  },
  {
    version: 2,
    name: "messaging-delivery-flags",
    // Two columns with defaults on an existing table: a rollback to a predecessor that
    // does not know them leaves them at their defaults and reads nothing.
    swapSafe: true,
    up(db) {
      // 0.2.7 → 0.2.8. ensureColumn rather than a bare ALTER because the declarative
      // track may already have added these (see the module doc's ADOPTION note).
      ensureColumn(db, "messaging_bindings", "final_reply_only", "INTEGER NOT NULL DEFAULT 0");
      ensureColumn(db, "messaging_bindings", "render_markdown", "INTEGER NOT NULL DEFAULT 1");
    },
  },
];

/** The highest version this build knows how to reach. */
export const LATEST_VERSION: number = MIGRATIONS.reduce((n, m) => Math.max(n, m.version), 0);

/** How far this database has been migrated. Unstamped (pre-migrations) databases read 0. */
export function schemaVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number } | undefined;
  return row?.user_version ?? 0;
}

export class RestartRequiredError extends Error {
  constructor(readonly migration: Migration) {
    super(
      `migration ${migration.version} (${migration.name}) is restart-only and cannot be applied ` +
        `while a pushed platform boots: it is not safe to leave behind if this boot is rolled back. ` +
        `Restart the runtime on a build that carries it, then push again.`,
    );
    this.name = "RestartRequiredError";
  }
}

/**
 * Applies every migration this database has not reached yet, in order.
 *
 * Each migration and its version stamp commit together, so an interrupted run leaves the
 * database at the last version that fully applied — never half-migrated. Already-current
 * databases do no work and touch nothing.
 *
 * `swapPath` marks the caller as a booting pushed platform: the first pending migration
 * that is not `swapSafe` throws RestartRequiredError BEFORE anything is applied, so the
 * push is refused whole rather than partially landed.
 */
export function migrate(
  db: DatabaseSync,
  { swapPath = false }: { swapPath?: boolean } = {},
): { from: number; to: number; applied: readonly string[] } {
  const from = schemaVersion(db);
  const pending = [...MIGRATIONS]
    .sort((a, b) => a.version - b.version)
    .filter((m) => m.version > from);
  if (swapPath) {
    const blocked = pending.find((m) => !m.swapSafe);
    if (blocked) throw new RestartRequiredError(blocked);
  }
  const applied: string[] = [];
  for (const m of pending) {
    db.exec("BEGIN");
    try {
      m.up(db);
      // PRAGMA takes no bound parameter; the value is this file's own integer literal.
      db.exec(`PRAGMA user_version = ${m.version}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(`migration ${m.version} (${m.name}) failed: ${String(err)}`, { cause: err });
    }
    applied.push(m.name);
  }
  return { from, to: schemaVersion(db), applied };
}
