/**
 * The SQLite database core: the connection (database.ts), the frozen schema (schema.ts),
 * and the ordered migrations (migrations.ts). The repos that shape the tables live with
 * the server (packages/server/src/db/repos) — they read the server's own types and
 * mechanisms, which this package must not.
 */
export {
  openExistingDatabase,
  openDatabase,
  openDatabaseReadOnly,
  ensureColumn,
} from "./database.js";
export { SCHEMA_SQL, MODEL_PROMOTIONS_SQL, MODEL_PROVIDER_AUTH_TOKENS_SQL } from "./schema.js";
export {
  MIGRATIONS,
  LATEST_VERSION,
  schemaVersion,
  migrate,
  IrreversibleMigrationError,
  RestartRequiredError,
} from "./migrations.js";
export type { Migration } from "./migrations.js";
