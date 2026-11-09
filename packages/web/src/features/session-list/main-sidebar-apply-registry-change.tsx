import { useMemo } from "react";
import { groupPageOf, workspaceGroupKey } from "../../lib/session-grouping";
import {
  mergeRegisteredWorkspaces,
  normalizeWorkspacePath,
  registerWorkspace,
  saveWorkspaceRegistry,
  setWorkspaceAlias,
  unregisterWorkspace,
  type WorkspaceEntry,
} from "./workspace-registry";
import { orderGroups } from "./group-order";
import {
  saveHiddenWorkspaces,
  setWorkspaceHidden,
  visibleWorkspaceGroups,
} from "./workspace-visibility";

import type { useMainSidebarNewEntity } from "./main-sidebar-new-entity";

/** Consecutive live main statements 125..131, called once in original hook order. */
export function useMainSidebarApplyRegistryChange(
  scope: ReturnType<typeof useMainSidebarNewEntity>,
) {
  const {
    machineLabels,
    currentProjectId,
    registeredWorkspaces,
    setRegisteredWorkspaces,
    hiddenWorkspaces,
    setHiddenWorkspaces,
    renamingWorkspace,
    setRenamingWorkspace,
    workspaceAliasText,
    setWorkspaceAliasText,
    deletingWorkspace,
    setDeletingWorkspace,
    setGroupPage,
    sessionWorkspaceGroups,
    pinnedGroups,
    groupOrder,
    groupMode,
  } = scope;

  /** Persist-if-changed for every registry mutation (register / alias / unregister share the same-reference fast exit). */
  const applyRegistryChange = (next: readonly WorkspaceEntry[]) => {
    if (next === registeredWorkspaces) return;
    setRegisteredWorkspaces(next);
    saveWorkspaceRegistry(currentProjectId, next);
  };

  const applyHiddenChange = (next: ReadonlySet<string>) => {
    if (next === hiddenWorkspaces) return;
    setHiddenWorkspaces(next);
    saveHiddenWorkspaces(currentProjectId, next);
  };

  /**
   * Register or restore the directory and reveal its page. A restored group with conversations
   * keeps their recency, pins and manual order, so its page may differ from an empty new group's.
   */
  const addWorkspace = (path: string, machineId?: string | null) => {
    const next = registerWorkspace(registeredWorkspaces, path, machineId ?? undefined);
    const nextHidden = setWorkspaceHidden(hiddenWorkspaces, path, machineId ?? null, false);
    if (next === registeredWorkspaces && nextHidden === hiddenWorkspaces) return;
    applyRegistryChange(next);
    applyHiddenChange(nextHidden);
    const key = workspaceGroupKey(normalizeWorkspacePath(path), machineId ?? null);
    const groups = orderGroups(
      visibleWorkspaceGroups(mergeRegisteredWorkspaces(sessionWorkspaceGroups, next), nextHidden),
      (g) => g.key,
      { pinned: pinnedGroups, order: groupMode === "workspace" ? groupOrder : [] },
    );
    const index = groups.findIndex((g) => g.key === key);
    setGroupPage(groupPageOf(Math.max(0, index)));
  };

  /**
   * The ssh alias of a group's machine, or null for this server's own groups — what a name
   * is qualified with. An unlabelled machine (the list is admin-only, and a machine can also
   * drop out of the ssh config) falls back to its id: honest, where inventing a name is not.
   */
  const machineNameOf = (machineId: string | null): string | null =>
    machineId === null ? null : (machineLabels.get(machineId) ?? machineId);

  /** Only registered Workspaces carry an editable alias; every directory group can be removed. */
  const registeredKeys = useMemo(
    () => new Set(registeredWorkspaces.map((e) => workspaceGroupKey(e.path, e.machineId ?? null))),
    [registeredWorkspaces],
  );

  /** Open the alias editor pre-filled with the current alias ("" = following the basename). */
  const openRenameWorkspace = (path: string, machineId: string | null) => {
    setWorkspaceAliasText(
      registeredWorkspaces.find((e) => e.path === path && (e.machineId ?? null) === machineId)
        ?.alias ?? "",
    );
    setRenamingWorkspace({ path, machineId });
  };

  /** Commit the alias (blank reverts the label to the directory basename). Direct save — no server, nothing destructive. */
  const confirmRenameWorkspace = (alias: string) => {
    if (!renamingWorkspace) return;
    applyRegistryChange(
      setWorkspaceAlias(
        registeredWorkspaces,
        renamingWorkspace.path,
        renamingWorkspace.machineId,
        alias,
      ),
    );
    setRenamingWorkspace(null);
  };

  /**
   * Hide the group as well as dropping its registration: otherwise its conversations recreate
   * it immediately. The removal stays local to this Project and machine; disk and conversations
   * are untouched, and adding the directory again restores the group.
   */
  const confirmDeleteWorkspace = () => {
    if (!deletingWorkspace) return;
    applyRegistryChange(
      unregisterWorkspace(
        registeredWorkspaces,
        deletingWorkspace.path,
        deletingWorkspace.machineId,
      ),
    );
    applyHiddenChange(
      setWorkspaceHidden(
        hiddenWorkspaces,
        deletingWorkspace.path,
        deletingWorkspace.machineId,
        true,
      ),
    );
    setDeletingWorkspace(null);
  };
  return {
    ...scope,
    applyRegistryChange,
    addWorkspace,
    machineNameOf,
    registeredKeys,
    openRenameWorkspace,
    confirmRenameWorkspace,
    confirmDeleteWorkspace,
  };
}
