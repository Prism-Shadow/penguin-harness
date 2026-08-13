/**
 * Manually-added Workspaces of the sidebar (pure decisions, unit tested): the header's
 * 新建工作区 button lets the user browse to a directory, and the picked path must show
 * up as a workspace group IMMEDIATELY — even with zero Sessions. There is no Workspace
 * entity on the server (groups are otherwise derived purely from Session paths), so the
 * picked paths persist frontend-side per Project (`penguin.…` key naming, injectable
 * storage — the model-group-expansion.ts convention) and merge into the grouping as
 * empty groups.
 *
 * An entry is `{ path, alias? }`: the alias is a display name set via the group's
 * 重命名工作区 (it replaces the basename as the group label — for session-backed groups
 * too — while the full path stays in the tooltip; an empty alias reverts to the
 * basename). Loads stay tolerant of the branch's earlier string-only stored shape.
 *
 * Lifecycle: an entry stays until 删除工作区 unregisters it (sidebar-only — disk and
 * Sessions are never touched; with Sessions present the group simply persists as
 * session-derived). Once Sessions exist the entry mostly dedups away at merge, but it
 * still carries the alias and keeps the group visible after those Sessions are gone.
 */
import { workspaceGroupKey, workspaceLabel } from "./session-grouping";
import type { WorkspaceGroup } from "./session-grouping";

/** One registered Workspace: the normalized path, plus an optional display alias. */
export interface WorkspaceEntry {
  path: string;
  /** Display name overriding the path basename (set via 重命名工作区; absent = basename). */
  alias?: string;
}

/** Minimal storage interface (the subset of localStorage used here); tests inject an in-memory implementation. */
export interface WorkspaceRegistryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Storage key of one Project's manually-added Workspaces (sidebar key-naming convention). */
export const workspaceRegistryKey = (projectId: string): string =>
  `penguin.sidebarWorkspaces.${projectId}`;

/**
 * Canonical form of a picked path: trimmed, trailing separators dropped (the server
 * hands back resolved paths without them, so `/srv/app/` must dedup against
 * `/srv/app`), the filesystem root kept as-is. Empty in → empty out (never registered).
 */
export function normalizeWorkspacePath(path: string): string {
  let p = path.trim();
  while (p.length > 1 && (p.endsWith("/") || p.endsWith("\\"))) p = p.slice(0, -1);
  return p;
}

/** Parses one stored element: a plain string (the branch's earlier shape) or an entry object; junk yields null. */
function parseEntry(x: unknown): WorkspaceEntry | null {
  if (typeof x === "string") {
    const p = normalizeWorkspacePath(x);
    return p === "" ? null : { path: p };
  }
  if (typeof x === "object" && x !== null && typeof (x as { path?: unknown }).path === "string") {
    const p = normalizeWorkspacePath((x as { path: string }).path);
    if (p === "") return null;
    const rawAlias = (x as { alias?: unknown }).alias;
    const alias = typeof rawAlias === "string" ? rawAlias.trim() : "";
    return alias === "" ? { path: p } : { path: p, alias };
  }
  return null;
}

/** Reads a Project's registered Workspaces; no Project, nothing stored, or corrupted storage degrade to empty. Junk elements are dropped, entries re-normalized and deduped (first wins), and the old string-only shape still loads. */
export function loadWorkspaceRegistry(
  projectId: string | null,
  storage: WorkspaceRegistryStorage = localStorage,
): WorkspaceEntry[] {
  if (projectId === null) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(workspaceRegistryKey(projectId)) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const out: WorkspaceEntry[] = [];
    for (const x of parsed) {
      const entry = parseEntry(x);
      if (entry !== null && !out.some((e) => e.path === entry.path)) out.push(entry);
    }
    return out;
  } catch {
    return [];
  }
}

/** Writes a Project's registered Workspaces (best-effort: quota limits / private browsing fail silently). */
export function saveWorkspaceRegistry(
  projectId: string | null,
  entries: readonly WorkspaceEntry[],
  storage: WorkspaceRegistryStorage = localStorage,
): void {
  if (projectId === null) return;
  try {
    storage.setItem(workspaceRegistryKey(projectId), JSON.stringify(entries));
  } catch {
    /* best-effort persistence (quota limits / private browsing) */
  }
}

/**
 * Registers a picked path: normalized and prepended (newest registration first — it
 * renders topmost). Returns the INPUT array unchanged (same reference) for an empty
 * path or an already-registered one — callers skip the state update and storage write.
 */
export function registerWorkspace(
  entries: readonly WorkspaceEntry[],
  path: string,
): readonly WorkspaceEntry[] {
  const p = normalizeWorkspacePath(path);
  if (p === "" || entries.some((e) => e.path === p)) return entries;
  return [{ path: p }, ...entries];
}

/**
 * Sets (or, with a blank alias, clears) a registered Workspace's display alias.
 * Returns the INPUT array unchanged (same reference) when the path isn't registered
 * or the alias doesn't actually change.
 */
export function setWorkspaceAlias(
  entries: readonly WorkspaceEntry[],
  path: string,
  alias: string,
): readonly WorkspaceEntry[] {
  const a = alias.trim();
  const entry = entries.find((e) => e.path === path);
  if (!entry || (entry.alias ?? "") === a) return entries;
  return entries.map((e) =>
    e.path === path ? (a === "" ? { path: e.path } : { path: e.path, alias: a }) : e,
  );
}

/** 删除工作区: drops the registry entry (sidebar-only — disk and Sessions are untouched). Same-reference fast exit when the path isn't registered. */
export function unregisterWorkspace(
  entries: readonly WorkspaceEntry[],
  path: string,
): readonly WorkspaceEntry[] {
  return entries.some((e) => e.path === path) ? entries.filter((e) => e.path !== path) : entries;
}

/**
 * Merges the registered Workspaces into the session-derived grouping: registered-only
 * paths become EMPTY groups prepended in registration order (a just-added Workspace
 * surfaces at the very top), labelled by alias ?? basename; paths whose group already
 * exists dedup away (matched by workspaceGroupKey, so trailing-separator variants
 * collide correctly) but still apply their alias to that group's label; a path that
 * reads as a temporary workspace never forms a group (the merged temp group owns that
 * space).
 */
export function mergeRegisteredWorkspaces<T>(
  groups: readonly WorkspaceGroup<T>[],
  registered: readonly WorkspaceEntry[],
): WorkspaceGroup<T>[] {
  const aliasByKey = new Map(
    registered.filter((e) => e.alias !== undefined).map((e) => [e.path, e.alias as string]),
  );
  const existing = new Set(groups.map((g) => g.key));
  const added: WorkspaceGroup<T>[] = [];
  for (const { path, alias } of registered) {
    const key = workspaceGroupKey(path);
    if (existing.has(key) || key !== path) continue; // already grouped, or a temp-shaped path
    existing.add(key);
    added.push({
      key,
      label: alias ?? workspaceLabel(path),
      fullPath: path,
      temp: false,
      sessions: [],
    });
  }
  const relabelled = groups.map((g) => {
    const alias = aliasByKey.get(g.key);
    return alias === undefined ? g : { ...g, label: alias };
  });
  return added.length === 0 ? relabelled : [...added, ...relabelled];
}
