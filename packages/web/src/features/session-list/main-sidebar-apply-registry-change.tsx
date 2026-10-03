import { useMemo } from "react";
import { groupPageOf, workspaceGroupKey } from "../../lib/session-grouping";
import {
  registerWorkspace,
  saveWorkspaceRegistry,
  setWorkspaceAlias,
  unregisterWorkspace,
  type WorkspaceEntry,
} from "./workspace-registry";

import type { useMainSidebarNewEntity } from "./main-sidebar-new-entity";

/** Consecutive live main statements 121..127, called once in original hook order. */
export function useMainSidebarApplyRegistryChange(
  scope: ReturnType<typeof useMainSidebarNewEntity>,
) {
  const {
    machineLabels,
    currentProjectId,
    registeredWorkspaces,
    setRegisteredWorkspaces,
    renamingWorkspace,
    setRenamingWorkspace,
    workspaceAliasText,
    setWorkspaceAliasText,
    deletingWorkspace,
    setDeletingWorkspace,
    setGroupPage,
    orderedWorkspaceGroups,
  } = scope;

  /** Persist-if-changed for every registry mutation (register / alias / unregister share the same-reference fast exit). */
  const applyRegistryChange = (next: readonly WorkspaceEntry[]) => {
    if (next === registeredWorkspaces) return;
    setRegisteredWorkspaces(next);
    saveWorkspaceRegistry(currentProjectId, next);
  };

  /**
   * 新建工作区: register the browsed pick so it surfaces as a group immediately, Sessions
   * or not. An empty registered group is appended and nothing pins or orders it yet, so it
   * lands last — turn to the page that now holds it, or to the page of the group that was
   * already there. Otherwise, past ten groups, the freshly added Workspace would sit on a
   * page the user is not looking at and the click would read as a no-op.
   */
  const addWorkspace = (path: string, machineId?: string | null) => {
    const next = registerWorkspace(registeredWorkspaces, path, machineId ?? undefined);
    if (next === registeredWorkspaces) return;
    applyRegistryChange(next);
    const key = workspaceGroupKey(path, machineId ?? null);
    const existing = orderedWorkspaceGroups.findIndex((g) => g.key === key);
    setGroupPage(groupPageOf(existing >= 0 ? existing : orderedWorkspaceGroups.length));
  };

  /**
   * The ssh alias of a group's machine, or null for this server's own groups — what a name
   * is qualified with. An unlabelled machine (the list is admin-only, and a machine can also
   * drop out of the ssh config) falls back to its id: honest, where inventing a name is not.
   */
  const machineNameOf = (machineId: string | null): string | null =>
    machineId === null ? null : (machineLabels.get(machineId) ?? machineId);

  /** Registered Workspaces by GROUP key — only their groups offer the rename/remove overflow. */
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
  const confirmRenameWorkspace = () => {
    if (!renamingWorkspace) return;
    applyRegistryChange(
      setWorkspaceAlias(
        registeredWorkspaces,
        renamingWorkspace.path,
        renamingWorkspace.machineId,
        workspaceAliasText,
      ),
    );
    setRenamingWorkspace(null);
  };

  /**
   * 删除工作区 (confirmed via the shared ConfirmModal, like every destructive-looking
   * action): drops the sidebar registry entry only — disk and Sessions are never
   * touched, the confirm copy says exactly that, and re-adding restores it. A group
   * that still has Sessions simply persists as session-derived.
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
