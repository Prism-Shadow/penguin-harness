import { toastError, toastSuccess } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { groupPageOf, workspaceGroupKey } from "../../lib/session-grouping";
import { machineForSession } from "../../lib/session-machines";
import { S } from "../../lib/strings";
import { toastApiError } from "../../lib/toast-api-error";
import { deleteWorkspaceGroup, isOutdatedMachine } from "./delete-workspace";
import {
  registerWorkspace,
  saveWorkspaceRegistry,
  setWorkspaceAlias,
  unregisterWorkspace,
  type WorkspaceEntry,
} from "./workspace-registry";

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
    renamingWorkspace,
    setRenamingWorkspace,
    workspaceAliasText,
    setWorkspaceAliasText,
    deletingWorkspace,
    setDeletingWorkspace,
    deletingWorkspaceBusy,
    setDeletingWorkspaceBusy,
    setGroupPage,
    orderedWorkspaceGroups,
    sessions,
    activeSessionId,
    newChat,
    archiveGroup,
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

  /** Open the alias editor pre-filled with the current alias ("" = following the basename). */
  const openRenameWorkspace = (path: string, machineId: string | null) => {
    setWorkspaceAliasText(
      registeredWorkspaces.find((e) => e.path === path && (e.machineId ?? null) === machineId)
        ?.alias ?? "",
    );
    setRenamingWorkspace({ path, machineId });
  };

  /**
   * Commit the alias (blank reverts the label to the directory basename). Direct save — no
   * server, nothing destructive. Naming a group that was never registered registers it.
   */
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
   * 删除工作区, once the shared ConfirmModal is confirmed (delete-workspace.ts): the group's
   * active conversations are archived on the server that holds them, then the group leaves the
   * list and its registry entry goes; disk is never touched. A group with none only loses its
   * entry. A failed request keeps the dialog open and everything as it was.
   */
  const confirmDeleteWorkspace = async () => {
    if (!deletingWorkspace || deletingWorkspaceBusy || currentProjectId === null) return;
    setDeletingWorkspaceBusy(true);
    const target = deletingWorkspace;
    const projectId = currentProjectId;
    try {
      const outcome = await deleteWorkspaceGroup(target, {
        archive: (group, machineId) =>
          api.archiveWorkspaceSessions(projectId, group, machineId).then((r) => r.done),
        leaveIfOpenIn: (key) => {
          const open = sessions.find((s) => s.sessionId === activeSessionId);
          if (
            open &&
            workspaceGroupKey(open.workspace, machineForSession(open.sessionId)) === key
          ) {
            newChat();
          }
        },
        archiveGroup,
        unregister: (path, machineId) =>
          applyRegistryChange(unregisterWorkspace(registeredWorkspaces, path, machineId)),
      });
      if (outcome.ok) {
        setDeletingWorkspace(null);
        if (outcome.archived > 0) toastSuccess(S.chat.deleteWorkspaceArchived(outcome.archived));
      } else if (isOutdatedMachine(outcome.error, target.machineId)) {
        toastError(S.chat.deleteWorkspaceMachineOutdated(machineNameOf(target.machineId) ?? ""));
      } else {
        toastApiError(outcome.error);
      }
    } finally {
      setDeletingWorkspaceBusy(false);
    }
  };
  return {
    ...scope,
    applyRegistryChange,
    addWorkspace,
    machineNameOf,
    openRenameWorkspace,
    confirmRenameWorkspace,
    confirmDeleteWorkspace,
  };
}
