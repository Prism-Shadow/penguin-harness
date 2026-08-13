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
  ensureColumn(db, "sessions", "last_active_at", "TEXT");
  ensureColumn(db, "auth_sessions", "via", "TEXT");
  ensureColumn(db, "trace_files", "page_stats", "TEXT");
  // last_active_at backfill for rows formed before the column existed: the session's most
  // recent request timestamp (usage_records, served by idx_usage_session — the closest
  // persisted proxy for "last Trace activity"), else created_at. Guarded by IS NULL so it
  // is idempotent — a backfilled database matches 0 rows, and a crash between the ALTER
  // above and this UPDATE heals on the next open.
  db.exec(
    `UPDATE sessions SET last_active_at = COALESCE(
       (SELECT MAX(ts) FROM usage_records WHERE usage_records.session_id = sessions.session_id),
       created_at
     ) WHERE last_active_at IS NULL`,
  );
  return db;
}

/** Idempotent per-column upgrade for databases formed before the column existed. */
function ensureColumn(db: DatabaseSync, table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}
