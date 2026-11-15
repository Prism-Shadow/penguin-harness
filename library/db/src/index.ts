/**
 * The server's SQLite database as a library package: the connection, the table-creation
 * SQL, the named migrations, and the `Db` capability the runtime publishes for the
 * booting platform to claim. One package, no server dependencies — packages/server
 * imports these; nothing here imports the server (and nothing here imports its repos:
 * they implement their own domains' contracts and move with those domains, L02+).
 *
 * Three subpaths:
 * - `.` — the connection: openDatabase (creating, migrating), openExistingDatabase
 *   (a narrow write against a live server), openDatabaseReadOnly (a reader that cannot
 *   reshape a server's schema), the per-column guard, and the Db capability class.
 * - `./schema` — the table-creation SQL (SCHEMA_SQL), importable without opening anything.
 * - `./migrations` — the ledger: MIGRATIONS, migrate, rollbackTo, the Migration shape.
 */
import type { DatabaseSync } from "node:sqlite";
import { Interface, Opaque } from "@prismshadow/penguin-core/kernel";

export { openDatabase, openDatabaseReadOnly, openExistingDatabase, ensureColumn } from "./database.js";

/** The SQLite handle (single-writer, one per process). Statements are host objects. */
@Interface()
export abstract class Db {
  abstract prepare(sql: string): Opaque<"StatementSync", ReturnType<DatabaseSync["prepare"]>>;
  abstract exec(sql: string): void;
  abstract close(): void;
}
