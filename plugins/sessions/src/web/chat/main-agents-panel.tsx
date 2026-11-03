import { EmptyState, ICONS } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { panelLabel, type PanelId } from "../dock/index";

import { approvalModeChoices } from "./approval-mode";
import { useChatDock } from "./session/main-dock-context";
import { SubagentsView } from "./subagents-view";
function draftPlaceholder(id: PanelId) {
  return (
    <EmptyState
      title={panelLabel(id)}
      // The schedules tab says what the first message unlocks; the other tabs share one line.
      description={id === "schedules" ? S.schedule.panelDraftEmpty : S.dock.draftEmpty}
    />
  );
}
function AgentsPanelBody() {
  const {
    selected,
    panelModel,
    stream,
    ctx,
    subagentFocus,
    subagentTaskScope,
    models,
    onChangePermission,
    modeSaving,
    parentThinkingLevel,
  } = useChatDock();
  if (!selected) return draftPlaceholder("agents");
  return (
    <SubagentsView
      key={selected.sessionId}
      session={selected}
      // The merged view (backfilled windows included): a chip on an older turn keeps
      // its historical graph and child conversation reachable after pagination.
      model={panelModel}
      version={stream.version}
      taskRunning={stream.taskState !== "idle"}
      ctx={ctx}
      focusRequest={subagentFocus}
      taskScope={subagentTaskScope}
      subagents={stream.subagents}
      models={models?.models ?? []}
      approvalMode={selected.approvalMode}
      approvalModes={approvalModeChoices(selected.client, selected.approvalMode)}
      onChangePermission={onChangePermission}
      modeSaving={modeSaving}
      parentThinkingLevel={parentThinkingLevel}
    />
  );
}
export const mainPanelDefinition = {
  id: "agents",
  label: () => S.chat.openAgents,
  glyph: ICONS.robotPair,
  order: 10,
  Body: AgentsPanelBody,
};
