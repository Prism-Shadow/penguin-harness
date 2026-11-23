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
import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  migrateDataRootLayout,
  relocateProjectWorkspacePaths,
  windowsDataMoves,
} from "@prismshadow/penguin-core";
import { rewriteWebDbPaths, webDbPathStore } from "./web-db-paths.js";

async function alreadyApplied(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function migrateDataRoot(
  root: string,
  db: DatabaseSync,
  log: (line: string) => void,
): Promise<void> {
  const moves = windowsDataMoves(root);
  if (moves.length > 0) {
    const files = db.prepare("PRAGMA database_list").all();
    const ownsDb = files.some(
      (file) =>
        file.name === "main" &&
        typeof file.file === "string" &&
        file.file !== "" &&
        path.relative(path.join(root, "web.db"), file.file) === "",
    );
    const dir = path.dirname(root);
    const marker = path.join(dir, "windows-project-paths-applied");
    if (!(await alreadyApplied(marker))) {
      await relocateProjectWorkspacePaths(root, moves, log);
      await fs.writeFile(marker, "");
    }
    // Only the database copied by Setup belongs to the move. An explicit external database
    // may be shared with another root. Its untouched copy can still be opened later.
    if (ownsDb) {
      const marker = path.join(dir, "windows-database-paths-applied");
      if (!(await alreadyApplied(marker))) {
        rewriteWebDbPaths(db, moves);
        await fs.writeFile(marker, "");
      }
    }
  }
  await migrateDataRootLayout(root, { store: webDbPathStore(db), log });
}
