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
 * DOWN, AND WHO DOES NOT CALL IT. Every migration declares an undo — or declares `null`
 * to say it has none, which is a decision the author has to make rather than omit. What
 * `down` is NOT is the hot-update rollback mechanism. When a pushed platform fails to boot
 * the runtime reverts to its PREDECESSOR and the schema stays where the migration left it:
 * undoing DDL inside a process whose boot just failed would run destructive statements
 * against a half-known state, and `swapSafe` exists precisely so that not undoing is safe —
 * the predecessor does not know the new table or column, so it never touches it. `down` is
 * an operator's tool, called deliberately (`rollbackTo`), never by the swap.
 *
 * It is also LOSSY by nature: undoing "add a table" drops that table with its rows in it.
 * Each `down` below names what its rows were.
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
  /**
   * Undoes `up`, or null when this migration cannot be undone — required, not optional, so
   * "there is no undo" is something the author states rather than forgets.
   *
   * Never called by the swap path (see the module doc): a failed boot reverts the platform,
   * not the schema. Reached only through `rollbackTo`, and destructive by nature — dropping
   * a table takes its rows with it.
   */
  down: ((db: DatabaseSync) => void) | null;
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
    // LOSES every messaging binding: the channel credentials, the enabled flag and the
    // last-chat memory all live in the table this drops. The auth_sessions indexes are
    // derived and cost nothing to lose.
    down(db) {
      db.exec(`
        DROP INDEX IF EXISTS idx_auth_sessions_user;
        DROP INDEX IF EXISTS idx_auth_sessions_expires;
        DROP INDEX IF EXISTS idx_messaging_by_account;
        DROP TABLE IF EXISTS messaging_bindings;
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
    // LOSES both delivery preferences on every binding; the bindings themselves survive.
    // Dropped in reverse order for symmetry with `up`. Neither column is indexed, which is
    // what lets SQLite drop them at all.
    down(db) {
      db.exec("ALTER TABLE messaging_bindings DROP COLUMN render_markdown");
      db.exec("ALTER TABLE messaging_bindings DROP COLUMN final_reply_only");
    },
  },
  {
    version: 3,
    name: "drop-goal-state",
    // Narrowing: drops a table. A pushed platform rolled back to 0.2.9 mid-process would
    // prepare its goal statements against a table that is gone (its declarative track only
    // runs at the runtime's own open, never at a platform boot), so this is the first
    // restart-only migration: refused on the swap path, applied by the runtime's open.
    swapSafe: false,
    up(db) {
      // 0.2.9 → 0.2.10. goal_state held goal mode's run state, one row per goal run, read
      // back only for the chat page's goal banner; the goal plugin's GOAL.json in the
      // Session scratchpad is that record now (see runtime/goal-events.ts). IF EXISTS only
      // because a database this build created never had the table.
      db.exec(`
        DROP INDEX IF EXISTS idx_goal_session;
        DROP TABLE IF EXISTS goal_state;
      `);
    },
    // Recreates the table exactly as 0.2.9 declared it — EMPTY. LOSES every goal run ever
    // recorded (objective, status, budget, used, rounds per run): the rows only ever fed the
    // banner of a finished goal, and a build with this migration reads the goal file instead.
    down(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS goal_state (
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
        CREATE INDEX IF NOT EXISTS idx_goal_session ON goal_state(session_id);
      `);
    },
  },
  {
    version: 4,
    name: "machines",
    // Three new tables, nothing existing touched: a platform rolled back to one without
    // machines never queries them. Swap-safe on its own; a database still behind
    // drop-goal-state is refused whole by that one first, which is the rule.
    swapSafe: true,
    up(db) {
      // Frozen copy of the DDL as of the machines feature; do not re-derive from schema.ts.
      // IF NOT EXISTS because the declarative track may already have created them (ADOPTION).
      db.exec(`
        CREATE TABLE IF NOT EXISTS machine (
          singleton  INTEGER PRIMARY KEY CHECK (singleton = 1),
          machine_id TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS machines (
          address      TEXT PRIMARY KEY,
          machine_id   TEXT,
          version      TEXT,
          installed_at TEXT,
          session_pid  INTEGER,
          remote_port  INTEGER,
          platform     TEXT
        );
        CREATE TABLE IF NOT EXISTS machine_project (
          project_id TEXT PRIMARY KEY REFERENCES projects(project_id) ON DELETE CASCADE,
          addresses  TEXT NOT NULL
        );
      `);
    },
    // LOSES this server's own machine id (every stored reference to it on other machines
    // then points at nothing), what was installed where, the sessions held, and which
    // machines each Project used.
    down(db) {
      db.exec(`
        DROP TABLE IF EXISTS machine_project;
        DROP TABLE IF EXISTS machines;
        DROP TABLE IF EXISTS machine;
      `);
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

export class IrreversibleMigrationError extends Error {
  constructor(readonly migration: Migration) {
    super(
      `migration ${migration.version} (${migration.name}) declares no down and cannot be rolled back. ` +
        `Restore the database from a backup taken before it was applied.`,
    );
    this.name = "IrreversibleMigrationError";
  }
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

/**
 * Reverts the database DOWN to `targetVersion`, newest migration first.
 *
 * An operator's tool, and a destructive one — see each migration's `down` for what its rows
 * were. Deliberately not reachable from the swap path: a failed platform boot reverts the
 * PLATFORM, never the schema (module doc).
 *
 * Refused whole, before anything runs, if any migration in range declares no `down`: a
 * partial rollback would leave the database at a version whose meaning nobody wrote down.
 * Each `down` commits with its version stamp, so an interrupted run stops at a real version.
 */
export function rollbackTo(
  db: DatabaseSync,
  targetVersion: number,
): { from: number; to: number; reverted: readonly string[] } {
  const from = schemaVersion(db);
  if (targetVersion < 0) throw new Error(`target version ${targetVersion} is negative`);
  if (targetVersion > from) {
    throw new Error(`database is at version ${from}, which is already below ${targetVersion}`);
  }
  const toRevert = [...MIGRATIONS]
    .filter((m) => m.version > targetVersion && m.version <= from)
    .sort((a, b) => b.version - a.version);
  const blocked = toRevert.find((m) => m.down === null);
  if (blocked) throw new IrreversibleMigrationError(blocked);

  const reverted: string[] = [];
  for (const m of toRevert) {
    db.exec("BEGIN");
    try {
      m.down!(db);
      // Versions are contiguous, so the predecessor of `m` is exactly m.version - 1.
      db.exec(`PRAGMA user_version = ${m.version - 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(`rollback of migration ${m.version} (${m.name}) failed: ${String(err)}`, {
        cause: err,
      });
    }
    reverted.push(m.name);
  }
  return { from, to: schemaVersion(db), reverted };
}
