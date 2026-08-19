/**
 * SQLite connection & initialization (node:sqlite DatabaseSync).
 *
 * Single process, single writer: a synchronous API is sufficient and avoids a connection
 * pool; WAL mode and foreign key constraints are enabled. Table-creation SQL runs on open
 * (idempotent), with no migration branches (product not yet released).
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { SCHEMA_SQL } from "./schema.js";

// Fetch the runtime module via process.getBuiltinModule (node >=22.3): avoids static
// resolution of `node:sqlite` by bundlers/vite (some tools' builtin lists don't yet
// recognize this experimental module).
const sqlite = process.getBuiltinModule("node:sqlite");

/** Open (creating if necessary) the database: ensure the parent directory exists, set PRAGMAs, run table creation. */
export function openDatabase(dbPath: string): DatabaseSync {
  if (dbPath !== ":memory:") {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new sqlite.DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA_SQL);
  // Columns added to the schema after a web.db was formed: CREATE TABLE IF NOT EXISTS never
  // touches an existing table, so they are ALTERed in here. Keep the list in sync with
  // schema.ts; drop entries only in a release allowed to break existing web.db files.
  ensureColumn(db, "sessions", "client", "TEXT");
  ensureColumn(db, "sessions", "has_trace", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "sessions", "fork_count", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "sessions", "thinking_level", "TEXT");
  ensureColumn(db, "auth_sessions", "via", "TEXT");
  ensureColumn(db, "trace_files", "page_stats", "TEXT");
  // Superseded by idx_usage_session_ts (session_id, ts), which SCHEMA_SQL just created on
  // this database: the old index is a strict prefix of it, so every query it served is
  // served identically. Dropping is safe — an index is derived, never data.
  db.exec("DROP INDEX IF EXISTS idx_usage_session");
  upgradeLastActiveAt(db);
  return db;
}

/**
 * One-time `sessions.last_active_at` upgrade, ALTER + backfill in a single transaction.
 *
 * The backfill runs **only in the open that actually adds the column** (SQLite's ALTER
 * TABLE ADD COLUMN is transactional, so a crash mid-upgrade rolls back to "no column" and
 * the next open redoes both halves — never a half-migrated table, and never a full
 * `sessions` scan on the millions of opens that follow). Legacy rows take the session's
 * most recent request timestamp — usage_records, covered by idx_usage_session_ts, the
 * closest persisted proxy for "last Trace activity" — else their own created_at.
 */
function upgradeLastActiveAt(db: DatabaseSync): void {
  db.exec("BEGIN");
  try {
    if (ensureColumn(db, "sessions", "last_active_at", "TEXT")) {
      db.exec(
        `UPDATE sessions SET last_active_at = COALESCE(
           (SELECT MAX(ts) FROM usage_records WHERE usage_records.session_id = sessions.session_id),
           created_at
         )`,
      );
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/**
 * Idempotent per-column upgrade for databases formed before the column existed.
 * Returns whether this call actually ALTERed the table (false = the column was already
 * there), so a caller can gate one-time backfill work on it.
 */
function ensureColumn(db: DatabaseSync, table: string, column: string, ddl: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (cols.some((c) => c.name === column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  return true;
}
