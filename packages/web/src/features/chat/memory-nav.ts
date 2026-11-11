/**
 * Navigation model and list view-model for the Memory side panel (pure; the component in
 * memory-view.tsx just renders these).
 *
 * Two levels: the list (both scopes' topic lists, changed topics marked, and under a topic the
 * files of its folder this conversation changed) and one memory's detail (its content, rendered
 * like the file viewer: Markdown for a topic, code for a file it keeps). Entry routes by where
 * the user came from: a memory-changes card row carries a locate target and lands directly on
 * that memory's detail; entering through the panel toggle (or any entry without a target) lands
 * on the list. Back always returns to the list.
 */
import type {
  MemoryFileInfo,
  MemoryFolderFile,
  MemoryScopeInfo,
} from "@prismshadow/penguin-server/api";
import {
  type MemoryChangeOp,
  type MemoryChangeRow,
  type MemoryLocateTarget,
  isFolderFilePath,
  memoryRowKey,
} from "../../lib/amsp/memory-changes";

export type MemoryNavMode = { kind: "list" } | { kind: "detail"; target: MemoryLocateTarget };

/** Entry routing: a request with a target goes straight to that memory's detail; no target (panel toggle, card header) shows the list. */
export function memoryNavForRequest(
  request: { target: MemoryLocateTarget | null } | null,
): MemoryNavMode {
  return request?.target != null ? { kind: "detail", target: request.target } : { kind: "list" };
}

/** The detail view's back button: always the list. */
export function memoryNavBack(): MemoryNavMode {
  return { kind: "list" };
}

/** One scope's server listing, as chat-page loads it (use-memory-listing). */
export interface ScopeFiles {
  info: MemoryScopeInfo;
  files: MemoryFileInfo[];
  /** Files in folders no topic keeps. */
  orphanFiles: MemoryFolderFile[];
}

/** One list-view row: a topic, or a file kept in a folder (a topic's, or one no topic keeps). */
export interface MemoryListRow {
  target: MemoryLocateTarget;
  /** `topic` — a Markdown fact; `file` — a file kept in a folder, shown by its path. */
  kind: "topic" | "file";
  /** A topic's listing title (frontmatter `name`); a kept file's path; the file path while the listing hasn't loaded. */
  title: string;
  description?: string;
  /** Frontmatter `updated_at` verbatim / file mtime (ISO); both absent on change-derived rows. */
  updatedAt?: string;
  modifiedAt?: string;
  /** Set when this conversation changed the file (the marker + its tooltip). */
  changed?: MemoryChangeOp;
  /** How many files a topic keeps in its folder; absent on a file row and while the listing hasn't loaded. */
  fileCount?: number;
}

export interface MemoryListGroup {
  scope: "user" | "workspace";
  scopeKey: string;
  workspacePath?: string;
  /** Topics, each followed by the files of its folder this conversation changed. */
  rows: MemoryListRow[];
  /** Files in folders no topic keeps, listed apart so none is hidden. */
  orphanRows: MemoryListRow[];
}

/** The row's target within its group's scope. */
function targetOf(
  group: { scope: "user" | "workspace"; scopeKey: string },
  file: string,
): MemoryLocateTarget {
  return group.scope === "user"
    ? { scope: "user", file }
    : { scope: "workspace", scopeKey: group.scopeKey, file };
}

/** A kept file's row: its path is its title. */
function fileRow(target: MemoryLocateTarget, file: MemoryFolderFile, changed?: MemoryChangeOp) {
  return {
    target,
    kind: "file" as const,
    title: file.path,
    modifiedAt: file.modifiedAt,
    ...(changed !== undefined ? { changed } : {}),
  };
}

/**
 * The list view's groups. With the listing loaded, its rows are the list — a changed topic
 * gets its marker, a changed file of its folder is listed right under it (so a script the
 * conversation wrote shows under the memory that keeps it), and a changed file the listing no
 * longer carries was deleted afterwards, so it simply doesn't appear. While the listing hasn't
 * loaded (null), the groups come from the changes alone: "not loaded yet" must not be mistaken
 * for "deleted".
 */
export function buildMemoryList(
  scopes: readonly ScopeFiles[] | null,
  changes: readonly MemoryChangeRow[],
): MemoryListGroup[] {
  if (scopes === null) {
    const groups: MemoryListGroup[] = [];
    for (const change of changes) {
      const scopeKey = change.scope === "user" ? "user" : (change.scopeKey ?? "");
      let group = groups.find((g) => g.scope === change.scope && g.scopeKey === scopeKey);
      if (group === undefined) {
        group = { scope: change.scope, scopeKey, rows: [], orphanRows: [] };
        if (change.scope === "user") groups.unshift(group);
        else groups.push(group);
      }
      group.rows.push({
        target: targetOf(group, change.file),
        kind: isFolderFilePath(change.file) ? "file" : "topic",
        title: change.file,
        changed: change.op,
      });
    }
    return groups;
  }

  const changedByKey = new Map(changes.map((c) => [memoryRowKey(c), c.op] as const));
  return scopes.map(({ info, files, orphanFiles }) => {
    const group: MemoryListGroup = {
      scope: info.kind,
      scopeKey: info.scopeKey,
      ...(info.workspacePath !== undefined ? { workspacePath: info.workspacePath } : {}),
      rows: [],
      orphanRows: [],
    };
    for (const f of files) {
      const target = targetOf(group, f.name);
      const changed = changedByKey.get(memoryRowKey(target));
      group.rows.push({
        target,
        kind: "topic",
        title: f.title,
        ...(f.description !== "" ? { description: f.description } : {}),
        ...(f.updatedAt !== undefined ? { updatedAt: f.updatedAt } : {}),
        modifiedAt: f.modifiedAt,
        ...(changed !== undefined ? { changed } : {}),
        fileCount: f.files.length,
      });
      for (const kept of f.files) {
        const keptTarget = targetOf(group, kept.path);
        const keptChange = changedByKey.get(memoryRowKey(keptTarget));
        if (keptChange !== undefined) group.rows.push(fileRow(keptTarget, kept, keptChange));
      }
    }
    for (const orphan of orphanFiles) {
      const target = targetOf(group, orphan.path);
      group.orphanRows.push(fileRow(target, orphan, changedByKey.get(memoryRowKey(target))));
    }
    return group;
  });
}

/**
 * Keys (memoryRowKey) of changed files the loaded listing no longer carries — they were
 * deleted after the change, so their entries are filtered out of the memory-changes card
 * (the panel list drops them by construction, see buildMemoryList). A file a topic keeps, or
 * one in a folder no topic keeps, is listed by its path like a topic is by its name. Null while
 * the listing hasn't loaded: "not loaded yet" must not be mistaken for "deleted".
 */
export function deletedChangeKeys(
  scopes: readonly ScopeFiles[] | null,
  changes: readonly MemoryChangeRow[],
): ReadonlySet<string> | null {
  if (scopes === null) return null;
  const listed = new Set<string>();
  for (const { info, files, orphanFiles } of scopes) {
    const group = { scope: info.kind, scopeKey: info.scopeKey };
    for (const f of files) {
      listed.add(memoryRowKey(targetOf(group, f.name)));
      for (const kept of f.files) listed.add(memoryRowKey(targetOf(group, kept.path)));
    }
    for (const orphan of orphanFiles) listed.add(memoryRowKey(targetOf(group, orphan.path)));
  }
  const deleted = new Set<string>();
  for (const change of changes) {
    const key = memoryRowKey(change);
    if (!listed.has(key)) deleted.add(key);
  }
  return deleted;
}
