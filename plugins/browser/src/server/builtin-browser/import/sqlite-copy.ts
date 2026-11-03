/**
 * Reads a browser's SQLite store through a private copy. A running browser holds its stores
 * open (on Windows exclusively), and reading a copy also guarantees the original is never
 * touched. The write-ahead log, its index and a rollback journal come along when present, so
 * pages the browser has not checkpointed yet are read too. The copy is opened read-only and
 * removed afterwards.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { ImportEnv } from "./index.js";

// Resolved at runtime, like db/database.ts: keeps bundlers from resolving `node:sqlite` statically.
const sqlite = process.getBuiltinModule("node:sqlite");

const COMPANIONS = ["-wal", "-shm", "-journal"];

export async function readDatabaseCopy<T>(
  file: string,
  env: ImportEnv,
  read: (db: DatabaseSync) => T,
): Promise<T> {
  const dir = await fs.mkdtemp(path.join(env.tmpdir, "penguin-browser-import-"));
  try {
    const copy = path.join(dir, path.basename(file));
    await fs.copyFile(file, copy);
    for (const suffix of COMPANIONS) {
      try {
        await fs.copyFile(file + suffix, copy + suffix);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    }
    const db = new sqlite.DatabaseSync(copy, { readOnly: true });
    try {
      return read(db);
    } finally {
      db.close();
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** The column names of a table, for stores whose schema changed across browser versions. */
export function columnsOf(db: DatabaseSync, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

/**
 * The warning for a store that could not be read. A copy that fails with a sharing violation
 * is a running browser holding the file (Windows); everything else is reported as unreadable.
 */
export function unreadableStoreWarning(err: unknown, browserName: string, store: string): string {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  if (code === "EBUSY" || code === "EPERM") {
    return `${browserName} is holding its ${store} open; close ${browserName} and import again.`;
  }
  return `The ${store} of ${browserName} could not be read.`;
}
