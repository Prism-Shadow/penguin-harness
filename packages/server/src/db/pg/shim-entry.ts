/**
 * Build entry that exposes the PG shim for integration tests (dist/db/pg/shim-entry.js).
 * Not imported by the server bundle; present in dist so a test can drive the shim
 * against a real PostgreSQL without booting the whole platform.
 */
export { PgDatabaseSync, openPgDatabase, pgConfigFromEnv } from "./shim.js";
export { translateStatement, translateScript, convertPlaceholders } from "./translate.js";
export type { PgConfig } from "./shim.js";
