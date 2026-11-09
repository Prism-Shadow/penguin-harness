/** Sidebar removal is independent of registration: conversations can keep an unregistered group alive. */
import { isTempWorkspace, workspaceGroupKey } from "../../lib/session-grouping";
import {
  readStringArray,
  writeStringArray,
  type SessionOrderStorage,
} from "../../lib/session-order";
import { normalizeWorkspacePath } from "./workspace-registry";

const hiddenWorkspacesKey = (projectId: string): string =>
  `penguin.sidebarHiddenWorkspaces.${projectId}`;

export function loadHiddenWorkspaces(
  projectId: string | null,
  storage?: SessionOrderStorage,
): ReadonlySet<string> {
  return new Set(
    projectId === null ? [] : readStringArray(hiddenWorkspacesKey(projectId), storage),
  );
}

export function saveHiddenWorkspaces(
  projectId: string | null,
  hidden: ReadonlySet<string>,
  storage?: SessionOrderStorage,
): void {
  if (projectId === null) return;
  writeStringArray(hiddenWorkspacesKey(projectId), [...hidden], storage);
}

/** Re-adding a directory clears only that machine's removal; no conversation is changed. */
export function setWorkspaceHidden(
  hidden: ReadonlySet<string>,
  path: string,
  machineId: string | null,
  remove: boolean,
): ReadonlySet<string> {
  const normalized = normalizeWorkspacePath(path);
  if (isTempWorkspace(normalized)) return hidden;
  const key = workspaceGroupKey(normalized, machineId);
  if (hidden.has(key) === remove) return hidden;
  const next = new Set(hidden);
  if (remove) next.add(key);
  else next.delete(key);
  return next;
}

/** Filter after registration and server counts are merged, before ordering and pagination. */
export function visibleWorkspaceGroups<T extends { key: string }>(
  groups: readonly T[],
  hidden: ReadonlySet<string>,
): T[] {
  return groups.filter((group) => !hidden.has(group.key));
}
