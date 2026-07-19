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
  return db;
}
