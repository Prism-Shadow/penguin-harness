/**
 * Manually-added Workspaces of the sidebar (pure decisions, unit tested): the header's
 * 新建工作区 button lets the user browse to a directory, and the picked path must show
 * up as a workspace group IMMEDIATELY — even with zero Sessions. There is no Workspace
 * entity on the server (groups are otherwise derived purely from Session paths), so the
 * picked paths persist frontend-side per Project (`penguin.…` key naming, injectable
 * storage — the model-group-expansion.ts convention) and merge into the grouping as
 * empty groups.
 *
 * Lifecycle: an entry stays until the profile clears it — once Sessions exist in the
 * directory the group is session-derived and the entry merely dedups away; if those
 * Sessions are later deleted the entry keeps the group visible, which is exactly its
 * job. There is deliberately no prune-on-delete here (nothing ever "deletes" a
 * Workspace), and no removal affordance yet — flagged in the PR.
 */
import { workspaceGroupKey, workspaceLabel } from "./session-grouping";
import type { WorkspaceGroup } from "./session-grouping";

/** Minimal storage interface (the subset of localStorage used here); tests inject an in-memory implementation. */
export interface WorkspaceRegistryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Storage key of one Project's manually-added Workspace paths (sidebar key-naming convention). */
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

/** Reads a Project's registered paths; no Project, nothing stored, or corrupted storage degrade to empty. Junk elements are dropped and entries re-normalized/deduped (older writes may predate a normalization tweak). */
export function loadWorkspaceRegistry(
  projectId: string | null,
  storage: WorkspaceRegistryStorage = localStorage,
): string[] {
  if (projectId === null) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(workspaceRegistryKey(projectId)) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    for (const x of parsed) {
      if (typeof x !== "string") continue;
      const p = normalizeWorkspacePath(x);
      if (p !== "" && !out.includes(p)) out.push(p);
    }
    return out;
  } catch {
    return [];
  }
}

/** Writes a Project's registered paths (best-effort: quota limits / private browsing fail silently). */
export function saveWorkspaceRegistry(
  projectId: string | null,
  paths: readonly string[],
  storage: WorkspaceRegistryStorage = localStorage,
): void {
  if (projectId === null) return;
  try {
    storage.setItem(workspaceRegistryKey(projectId), JSON.stringify(paths));
  } catch {
    /* best-effort persistence (quota limits / private browsing) */
  }
}

/**
 * Registers a picked path: normalized and prepended (newest registration first — it
 * renders topmost). Returns the INPUT array unchanged (same reference) for an empty
 * path or an already-registered one — callers skip the state update and storage write.
 */
export function registerWorkspace(paths: readonly string[], path: string): readonly string[] {
  const p = normalizeWorkspacePath(path);
  if (p === "" || paths.includes(p)) return paths;
  return [p, ...paths];
}

/**
 * Merges the registered paths into the session-derived grouping as EMPTY groups:
 * registered-only paths become zero-session groups prepended in registration order
 * (a just-added Workspace surfaces at the very top); paths whose group already exists
 * dedup away (matched by workspaceGroupKey, so trailing-separator variants collide
 * correctly), and a path that reads as a temporary workspace never forms a group (the
 * merged temp group owns that space).
 */
export function mergeRegisteredWorkspaces<T>(
  groups: readonly WorkspaceGroup<T>[],
  registered: readonly string[],
): WorkspaceGroup<T>[] {
  const existing = new Set(groups.map((g) => g.key));
  const added: WorkspaceGroup<T>[] = [];
  for (const path of registered) {
    const key = workspaceGroupKey(path);
    if (existing.has(key) || key !== path) continue; // already grouped, or a temp-shaped path
    existing.add(key);
    added.push({ key, label: workspaceLabel(path), fullPath: path, temp: false, sessions: [] });
  }
  return added.length === 0 ? [...groups] : [...added, ...groups];
}
