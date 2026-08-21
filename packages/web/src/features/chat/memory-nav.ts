/**
 * Navigation model and list view-model for the Memory side panel (pure; the component in
 * memory-view.tsx just renders these).
 *
 * Two levels: the list (both scopes' topic lists, changed topics marked) and one memory's
 * detail (its content, rendered like the file viewer). Entry routes by where the user came
 * from: a memory-changes card row carries a locate target and lands directly on that
 * memory's detail; entering through the panel toggle (or any entry without a target) lands
 * on the list. Back always returns to the list.
 */
import type { MemoryFileInfo, MemoryScopeInfo } from "@prismshadow/penguin-server/api";
import type {
  MemoryChangeOp,
  MemoryChangeRow,
  MemoryLocateTarget,
} from "../../lib/omni/memory-changes";
import { memoryRowKey } from "../../lib/omni/memory-changes";

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
}

/** One list-view row: a topic file. */
export interface MemoryListRow {
  target: MemoryLocateTarget;
  /** Listing title (frontmatter `name`), or the file path while the listing hasn't loaded. */
  title: string;
  description?: string;
  /** Frontmatter `updated_at` verbatim / file mtime (ISO); both absent on change-derived rows. */
  updatedAt?: string;
  modifiedAt?: string;
  /** Set when this conversation changed the topic (the marker + its tooltip). */
  changed?: MemoryChangeOp;
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
 * The list view's groups. With the listing loaded, its rows are the list — a changed topic
 * gets its marker, and a changed file the listing no longer carries was deleted afterwards,
 * so it simply doesn't appear. While the listing hasn't loaded (null), the groups come from
 * the changes alone: "not loaded yet" must not be mistaken for "deleted".
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
        group = { scope: change.scope, scopeKey, rows: [] };
        if (change.scope === "user") groups.unshift(group);
        else groups.push(group);
      }
      group.rows.push({
        target: targetOf(group, change.file),
        title: change.file,
        changed: change.op,
      });
    }
    return groups;
  }

  const changedByKey = new Map(changes.map((c) => [memoryRowKey(c), c.op] as const));
  return scopes.map(({ info, files }) => {
    const group: MemoryListGroup = {
      scope: info.kind,
      scopeKey: info.scopeKey,
      ...(info.workspacePath !== undefined ? { workspacePath: info.workspacePath } : {}),
      rows: [],
    };
    for (const f of files) {
      const target = targetOf(group, f.name);
      const changed = changedByKey.get(memoryRowKey(target));
      group.rows.push({
        target,
        title: f.title,
        ...(f.description !== "" ? { description: f.description } : {}),
        ...(f.updatedAt !== undefined ? { updatedAt: f.updatedAt } : {}),
        modifiedAt: f.modifiedAt,
        ...(changed !== undefined ? { changed } : {}),
      });
    }
    return group;
  });
}

/**
 * Keys (memoryRowKey) of changed files the loaded listing no longer carries — they were
 * deleted after the change, so their entries are filtered out of the memory-changes card
 * (the panel list drops them by construction, see buildMemoryList). Null while the listing
 * hasn't loaded: "not loaded yet" must not be mistaken for "deleted".
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
