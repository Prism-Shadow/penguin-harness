/**
 * The absolute paths web.db stores, rewritten when the layout migration moves a folder of the
 * data root (core's state/layout-migration/, PRFC-0034): by prefix only, so a path under the old
 * folder gets the same place under the new one and a user's path outside the data root is left
 * exactly as it was. All of it in one transaction:
 *
 *   sessions.workspace         a Session's Workspace (temporary ones live inside the Project)
 *   sessions.sandbox           the Session's sandbox snapshot: its `maskPaths`
 *   agent_api.workspace        the Workspace an Agent API run is given
 *   trace_sessions.workspace   the Trace cache's copy of a Session's Workspace, kept in line
 *                              with `sessions` (re-reading the Traces would bring the old paths
 *                              back: Traces are never rewritten)
 *   server_settings            the sandbox settings (`plugin-config:sandbox`): their `maskPaths`
 *   user_drafts.value_json     a draft's `workspace`
 *
 * A table or column an older schema lacks is skipped: the platform may run this over a web.db
 * its runtime opened before the table existed.
 *
 * Compatibility owner: core's `state/layout-migration/` owner, removed with the migration at 1.0.
 */
import type { DatabaseSync } from "node:sqlite";
import { movedPath, type LayoutStore, type PathMove } from "@prismshadow/penguin-core";

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some((row) => row.name === column);
}

/** Rewrites a text column holding one path. */
function rewriteColumn(
  db: DatabaseSync,
  table: string,
  column: string,
  moves: readonly PathMove[],
): void {
  if (!hasColumn(db, table, column)) return;
  const update = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE rowid = ?`);
  const rows = db
    .prepare(`SELECT rowid AS id, ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL`)
    .all() as { id: number; value: unknown }[];
  for (const row of rows) {
    if (typeof row.value !== "string") continue;
    const next = movedPath(row.value, moves);
    if (next !== null) update.run(next, row.id);
  }
}

/** Rewrites a JSON text column through `edit`, which answers the document changed or null. */
function rewriteJsonColumn(
  db: DatabaseSync,
  table: string,
  column: string,
  where: string,
  edit: (doc: Record<string, unknown>) => Record<string, unknown> | null,
): void {
  if (!hasColumn(db, table, column)) return;
  const update = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE rowid = ?`);
  const rows = db
    .prepare(`SELECT rowid AS id, ${column} AS value FROM ${table} WHERE ${where}`)
    .all() as { id: number; value: unknown }[];
  for (const row of rows) {
    if (typeof row.value !== "string") continue;
    let doc: unknown;
    try {
      doc = JSON.parse(row.value);
    } catch {
      continue;
    }
    if (doc === null || typeof doc !== "object" || Array.isArray(doc)) continue;
    const next = edit(doc as Record<string, unknown>);
    if (next !== null) update.run(JSON.stringify(next), row.id);
  }
}

/** The document with its `maskPaths` moved, or null when none of them moved. */
function movedMasks(moves: readonly PathMove[]) {
  return (doc: Record<string, unknown>): Record<string, unknown> | null => {
    const masks = doc.maskPaths;
    if (!Array.isArray(masks)) return null;
    let changed = false;
    const next = masks.map((p: unknown) => {
      const moved = typeof p === "string" ? movedPath(p, moves) : null;
      if (moved === null) return p;
      changed = true;
      return moved;
    });
    return changed ? { ...doc, maskPaths: next } : null;
  };
}

/** The document with its `workspace` moved, or null when it did not move. */
function movedWorkspace(moves: readonly PathMove[]) {
  return (doc: Record<string, unknown>): Record<string, unknown> | null => {
    const moved = typeof doc.workspace === "string" ? movedPath(doc.workspace, moves) : null;
    return moved === null ? null : { ...doc, workspace: moved };
  };
}

/** Rewrites every path web.db stores under a move's `from`, in one transaction. */
export function rewriteWebDbPaths(db: DatabaseSync, moves: readonly PathMove[]): void {
  if (moves.length === 0) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    rewriteColumn(db, "sessions", "workspace", moves);
    rewriteColumn(db, "agent_api", "workspace", moves);
    rewriteColumn(db, "trace_sessions", "workspace", moves);
    rewriteJsonColumn(db, "sessions", "sandbox", "sandbox IS NOT NULL", movedMasks(moves));
    rewriteJsonColumn(
      db,
      "server_settings",
      "value",
      "key = 'plugin-config:sandbox'",
      movedMasks(moves),
    );
    rewriteJsonColumn(db, "user_drafts", "value_json", "1 = 1", movedWorkspace(moves));
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** web.db as the layout migration's store of stored paths. */
export function webDbPathStore(db: DatabaseSync): LayoutStore {
  return { rewritePaths: (moves) => rewriteWebDbPaths(db, moves) };
}
