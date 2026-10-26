/**
 * PostgreSQL backend for the platform DB layer (PENGUIN_DB=pg).
 *
 * - shim.ts     DatabaseSync-compatible handle (sync API over a worker thread)
 * - worker.ts   the worker: one dedicated pg.Client per handle
 * - translate.ts SQLite → PostgreSQL statement translation
 */
export { PgDatabaseSync, openPgDatabase, pgConfigFromEnv } from "./shim.js";
export type { PgConfig, PgDatabaseSyncLike, PgStatementSyncLike } from "./shim.js";
export { translateStatement, translateScript, splitStatements, convertPlaceholders } from "./translate.js";
