import { Fold, GroupHeader, ICONS, ICON_SIZE, SkeletonList } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { nameOnMachine } from "../../lib/workspace-machines";
import { Icon } from "../../components/ui/group-list";
import { GroupBlock } from "./main-group-block";
import { GroupOverflowMenu } from "./main-group-overflow-menu";
import { GroupPinButton } from "./main-group-pin-button";
import { GROUP_ACTION_CLASS } from "../../lib/main-sidebar-persistence";
import type { MainSidebarState } from "./main-sidebar-controller";

export function renderMainGroupByWorkspace(scope: MainSidebarState) {
  const {
    loading,
    sessions,
    groupMode,
    collapsedGroups,
    pinnedGroups,
    setDeletingWorkspace,
    workspaceGroupCounts,
    orderedWorkspaceGroups,
    workspaceGroupSequence,
    toggleGroup,
    togglePin,
    searching,
    groupsOnPage,
    filterRows,
    groupDragProps,
    newChat,
    browseFiles,
    machineNameOf,
    registeredKeys,
    openRenameWorkspace,
    renderGroupBody,
  } = scope;
  return groupMode !== "workspace" ? null : loading && sessions.length === 0 ? (
    <SkeletonList rows={5} />
  ) : orderedWorkspaceGroups.length === 0 && !searching ? (
    <p className="px-2.5 pt-3 text-xs text-gray-400 dark:text-gray-600">{S.chat.noSessions}</p>
  ) : (
    // Same search treatment as agent mode: paging bypassed, zero-match groups hidden, the rest forced open.
    groupsOnPage(orderedWorkspaceGroups).map((group) => {
      const groupRows = filterRows(group.sessions);
      if (searching && groupRows.length === 0) return null;
      const collapsed = !searching && collapsedGroups.has(group.key);
      const pinned = pinnedGroups.has(group.key);
      /** Header tooltip: the full Workspace path, named on its machine. */
      const qualifiedPath =
        group.fullPath !== null
          ? nameOnMachine(group.fullPath, machineNameOf(group.machineId))
          : null;
      const drag = groupDragProps(group.key, workspaceGroupSequence);
      /** This group's exact server share (per-Workspace fold) and its fetch fan-out. */
      const counts = workspaceGroupCounts.get(group.key);
      /** Read once so the registry actions below keep the narrowing (null = the merged temp group, which has no single path). */
      const fullPath = group.fullPath;
      /** The ssh alias qualifying this group's names, or null when it is on this server. */
      const machineName = machineNameOf(group.machineId);
      const activeAgents = [
        ...new Set([...(counts?.agents.active ?? []), ...group.sessions.map((s) => s.agentId)]),
      ];
      return (
        <GroupBlock key={group.key} dropEdge={drag.dropEdge}>
          {/* Group header: collapse toggle (folder icon + directory basename + count, full
                  path in the tooltip; the count = the group's conversations, exact server share,
                  loaded rows win a disagreement) + pin + new chat in this Workspace; also the
                  group's drag handle. */}
          <GroupHeader
            {...drag.header}
            open={!collapsed}
            onToggle={() => toggleGroup(group.key)}
            // The folder opens and closes with the group.
            glyph={collapsed ? ICONS.folder : ICONS.folderOpen}
            label={group.temp ? S.chat.tempWorkspaces : group.label}
            // The machine stays readable however narrow the column: two machines'
            // groups can share a name, and the machine is what tells them apart.
            {...(machineName !== null
              ? { qualifier: S.chat.machineTag(machineName) }
              : {})}
            count={
              searching ? groupRows.length : Math.max(counts?.totals.active ?? 0, groupRows.length)
            }
            {...(qualifiedPath !== null ? { title: qualifiedPath } : {})}
            actions={
              <>
                <GroupPinButton pinned={pinned} onToggle={() => togglePin(group.key)} />
                {/* New chat in this Workspace: pre-fills the group's path in the draft ("" = temporary workspace); the Agent is the Project's new-chat default, like any other new chat */}
                <button
                  type="button"
                  data-tooltip={S.chat.newSessionInWorkspace}
                  aria-label={S.chat.newSessionInWorkspace}
                  onClick={() =>
                    newChat({
                      workspace: fullPath ?? "",
                      // The machine travels with the path: this group's rows live on it,
                      // and the same path here is a different directory (or none).
                      ...(group.machineId ? { machineId: group.machineId } : {}),
                    })
                  }
                  className={GROUP_ACTION_CLASS}
                >
                  <Icon d={ICONS.plus} size={ICON_SIZE.groupHeaderAction} />
                </button>
                {/* A group that is one directory (not the merged temporary group):
                              the overflow right of the "+" — browse its files, and, for a
                              manually-added (registry-backed) Workspace, rename the alias or
                              remove it from the sidebar (session-derived groups have no
                              registry entry for those two to act on). */}
                {fullPath !== null && (
                  <GroupOverflowMenu
                    onBrowse={() => browseFiles(fullPath, group.machineId)}
                    {...(registeredKeys.has(group.key)
                      ? {
                          onRename: () => openRenameWorkspace(fullPath, group.machineId),
                          onDelete: () =>
                            setDeletingWorkspace({
                              path: fullPath,
                              machineId: group.machineId,
                              label: group.label,
                            }),
                        }
                      : {})}
                  />
                )}
              </>
            }
          />

          {/* A workspace group can span Agents: the group body fans "More" out to the
                  Agents whose share of THIS group is non-zero (plus the Agents already
                  contributing loaded rows). */}
          <Fold open={!collapsed}>
            {() => renderGroupBody(group.key, groupRows, true, counts?.totals.active, activeAgents)}
          </Fold>
        </GroupBlock>
      );
    })
  );
}
