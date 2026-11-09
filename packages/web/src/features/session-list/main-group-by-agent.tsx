import {
  AgentAvatar,
  Fold,
  GroupHeader,
  ICONS,
  ICON_SIZE,
  SkeletonList,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { agentDisplayName } from "../../state/project";
import { Icon } from "../../components/ui/group-list";
import { employmentsOf } from "../agents";
import { GROUP_ACTION_CLASS } from "../../lib/main-sidebar-persistence";
import { GroupBlock } from "./main-group-block";
import { GroupPinButton } from "./main-group-pin-button";
import type { MainSidebarState } from "./main-sidebar-controller";

export function renderMainGroupByAgent(scope: MainSidebarState) {
  const {
    agents,
    countsByAgent,
    loading,
    byAgent,
    groupMode,
    collapsedGroups,
    pinnedGroups,
    orderedAgents,
    agentGroupSequence,
    toggleGroup,
    togglePin,
    searching,
    groupsOnPage,
    filterRows,
    groupDragProps,
    go,
    newChat,
    renderGroupBody,
  } = scope;
  return groupMode === "agent" ? (
    loading && agents.length === 0 ? (
      <SkeletonList rows={5} />
    ) : (
      // While searching: every group renders (paging bypassed), zero-match groups
      // hide, and the rest are forced open — a hit inside a collapsed group would
      // look like a missing result.
      groupsOnPage(orderedAgents).map((agent) => {
        const groupRows = filterRows(byAgent.get(agent.agentId) ?? []);
        if (searching && groupRows.length === 0) return null;
        const collapsed = !searching && collapsedGroups.has(agent.agentId);
        const pinned = pinnedGroups.has(agent.agentId);
        const drag = groupDragProps(agent.agentId, agentGroupSequence);
        /** An organization's employee says so in its header's tooltip. */
        const employments = employmentsOf(agent);
        const employeeNote = employments.length === 0 ? null : S.agent.employeeMark(employments);
        return (
          <GroupBlock key={agent.agentId} dropEdge={drag.dropEdge}>
            {/* Group header: collapse toggle (Agent name) + pin + new chat + Agent settings; also the group's drag handle. */}
            <GroupHeader
              {...drag.header}
              open={!collapsed}
              onToggle={() => toggleGroup(agent.agentId)}
              icon={
                <AgentAvatar
                  id={agent.agentId}
                  name={agentDisplayName(agent)}
                  size={18}
                  className="shrink-0 rounded"
                />
              }
              label={agentDisplayName(agent)}
              uppercase
              {...(employeeNote === null ? {} : { title: employeeNote })}
              actions={
                <>
                  <GroupPinButton pinned={pinned} onToggle={() => togglePin(agent.agentId)} />
                  {/* New chat: enters draft state directly with this group's Agent (all options live on the draft input card) */}
                  <button
                    type="button"
                    data-tooltip={S.chat.newSessionMenu}
                    aria-label={S.chat.newSessionMenu}
                    onClick={() => newChat({ agentId: agent.agentId })}
                    className={GROUP_ACTION_CLASS}
                  >
                    <Icon d={ICONS.plus} size={ICON_SIZE.groupHeaderAction} />
                  </button>
                  <button
                    type="button"
                    data-tooltip={S.agent.settings}
                    aria-label={S.agent.settings}
                    onClick={() => go(`/agents/${agent.agentId}`)}
                    className={GROUP_ACTION_CLASS}
                  >
                    <Icon d={ICONS.gear} size={ICON_SIZE.groupHeaderAction} />
                  </button>
                </>
              }
            />

            <Fold open={!collapsed}>
              {() =>
                renderGroupBody(
                  agent.agentId,
                  groupRows,
                  false,
                  countsByAgent.get(agent.agentId)?.active,
                  [agent.agentId],
                )
              }
            </Fold>
          </GroupBlock>
        );
      })
    )
  ) : null;
}
