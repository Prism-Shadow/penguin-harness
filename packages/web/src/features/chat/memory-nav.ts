/**
 * Navigation model and list view-model for the side panel's Memory tab (pure; the component
 * in memory-view.tsx just renders these).
 *
 * Two levels: the list (both scopes' topic lists, changed topics marked) and one memory's
 * detail (its diffs from this conversation pinned on top, then the content). Entry routes by
 * where the user came from: a memory-changes card row carries a locate target and lands
 * directly on that memory's detail; entering through the panel tab (or any entry without a
 * target) lands on the list. Back always returns to the list.
 */
import type { MemoryFileInfo, MemoryScopeInfo } from "@prismshadow/penguin-server/api";
import type {
  MemoryChangeOp,
  MemoryChangeRow,
  MemoryLocateTarget,
} from "../../lib/omni/memory-changes";
import { memoryRowKey } from "../../lib/omni/memory-changes";

export type MemoryNavMode = { kind: "list" } | { kind: "detail"; target: MemoryLocateTarget };

/** Entry routing: a request with a target goes straight to that memory's detail; no target (tab entry, card header) shows the list. */
export function memoryNavForRequest(
  request: { target: MemoryLocateTarget | null } | null,
): MemoryNavMode {
  return request?.target != null ? { kind: "detail", target: request.target } : { kind: "list" };
}

/** The detail view's back button: always the list. */
export function memoryNavBack(): MemoryNavMode {
  return { kind: "list" };
}

/** One scope's server listing, as the view loads it. */
export interface ScopeFiles {
  info: MemoryScopeInfo;
  files: MemoryFileInfo[];
}

/** One list-view row: a topic file, from the server listing and/or this conversation's changes. */
export interface MemoryListRow {
  target: MemoryLocateTarget;
  /** Listing title (frontmatter `name`), or the file path for a row the listing doesn't carry. */
  title: string;
  description?: string;
  /** Frontmatter `updated_at` verbatim / file mtime (ISO); both absent on unlisted rows. */
  updatedAt?: string;
  modifiedAt?: string;
  /** Set when this conversation changed the topic (the marker + its tooltip). */
  changed?: MemoryChangeOp;
  /** False for a row derived only from the change record — its content may not load (e.g. moved by a later shell command). */
  listed: boolean;
}

export interface MemoryListGroup {
  scope: "user" | "workspace";
  scopeKey: string;
  workspacePath?: string;
  rows: MemoryListRow[];
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

/**
 * Merges the server listing with this conversation's changes into the list view's groups:
 * listing order is kept and changed topics get their marker; a changed file the listing
 * doesn't carry is appended to its scope's group (created if absent — a User-scope group
 * goes first, matching the server's ordering) so its detail stays reachable. A null listing
 * (still loading, or failed) yields groups from the changes alone.
 */
export function buildMemoryList(
  scopes: readonly ScopeFiles[] | null,
  changes: readonly MemoryChangeRow[],
): MemoryListGroup[] {
  const groups: MemoryListGroup[] = [];
  const rowByKey = new Map<string, MemoryListRow>();
  for (const { info, files } of scopes ?? []) {
    const group: MemoryListGroup = {
      scope: info.kind,
      scopeKey: info.scopeKey,
      ...(info.workspacePath !== undefined ? { workspacePath: info.workspacePath } : {}),
      rows: [],
    };
    for (const f of files) {
      const target = targetOf(group, f.name);
      const row: MemoryListRow = {
        target,
        title: f.title,
        ...(f.description !== "" ? { description: f.description } : {}),
        ...(f.updatedAt !== undefined ? { updatedAt: f.updatedAt } : {}),
        modifiedAt: f.modifiedAt,
        listed: true,
      };
      group.rows.push(row);
      rowByKey.set(memoryRowKey(target), row);
    }
    groups.push(group);
  }
  for (const change of changes) {
    const existing = rowByKey.get(memoryRowKey(change));
    if (existing !== undefined) {
      existing.changed = change.op;
      continue;
    }
    const scopeKey = change.scope === "user" ? "user" : (change.scopeKey ?? "");
    let group = groups.find((g) => g.scope === change.scope && g.scopeKey === scopeKey);
    if (group === undefined) {
      group = { scope: change.scope, scopeKey, rows: [] };
      if (change.scope === "user") groups.unshift(group);
      else groups.push(group);
    }
    const target = targetOf(group, change.file);
    const row: MemoryListRow = {
      target,
      title: change.file,
      changed: change.op,
      listed: false,
    };
    group.rows.push(row);
    rowByKey.set(memoryRowKey(target), row);
  }
  return groups;
}

/**
 * Keys (memoryRowKey) of changed files the loaded listing no longer carries — they were
 * deleted after the change, so every entry point (card row, panel list row) renders them
 * unopenable instead of letting a click land on a 404. Null while the listing hasn't
 * loaded: "not loaded yet" must not be mistaken for "deleted".
 */
export function deletedChangeKeys(
  scopes: readonly ScopeFiles[] | null,
  changes: readonly MemoryChangeRow[],
): ReadonlySet<string> | null {
  if (scopes === null) return null;
  const listed = new Set<string>();
  for (const { info, files } of scopes) {
    const group = { scope: info.kind, scopeKey: info.scopeKey };
    for (const f of files) listed.add(memoryRowKey(targetOf(group, f.name)));
  }
  const deleted = new Set<string>();
  for (const change of changes) {
    const key = memoryRowKey(change);
    if (!listed.has(key)) deleted.add(key);
  }
  return deleted;
}

/** This conversation's change row for one memory, if it has one (the detail view's diff section). */
export function findChangeRow(
  changes: readonly MemoryChangeRow[],
  target: MemoryLocateTarget,
): MemoryChangeRow | undefined {
  const key = memoryRowKey(target);
  return changes.find((row) => memoryRowKey(row) === key);
}
