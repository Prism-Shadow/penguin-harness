/**
 * The server's run of the data root's layout migration (core's state/layout-migration/,
 * PRFC-0034), with web.db as the store of the paths it rewrites. Called at the server's start,
 * holding `server.lock` and before any route, runtime, file watcher or the plugin loader: by
 * the process entry (index.ts) before the platform boots, and again by the platform itself
 * before it builds anything (hmr/platform.ts), so a platform pushed onto a program from before
 * this layout migrates the root it is about to read. A root already migrated costs one listing of
 * its top level.
 *
 * What stops the migration stops the start: the error's message is the sentence a person reads
 * (the desktop app's start dialog, a machine's start failure).
 *
 * Compatibility owner: core's `state/layout-migration/` owner, removed with the migration at 1.0.
 */
import type { DatabaseSync } from "node:sqlite";
import { migrateDataRootLayout } from "@prismshadow/penguin-core";
import { webDbPathStore } from "./web-db-paths.js";

export async function migrateDataRoot(
  root: string,
  db: DatabaseSync,
  log: (line: string) => void,
): Promise<void> {
  await migrateDataRootLayout(root, { store: webDbPathStore(db), log });
}
