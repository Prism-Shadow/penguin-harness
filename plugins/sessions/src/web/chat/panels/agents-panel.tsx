/**
 * The agents panel (`DockModule.panels`, kind `agents`): the open conversation's subagent graph,
 * started over per conversation (keyed by Session).
 */
import { DraftPanelEmpty } from "../../../lib/dock-panel-empty";
import { sessionThinkingLevel } from "../../model-picker";
import { approvalModeChoices } from "../approval-mode";
import { SubagentsView } from "../subagents-view";
import { useChatControllerContext } from "../session/chat-session-context";

export function AgentsPanel() {
  const {
    selected,
    stream,
    ctx,
    panelModel,
    models,
    subagentFocus,
    subagentTaskScope,
    modeSaving,
    turnThinkingLevel,
    agentThinkingLevel,
    onChangePermission,
  } = useChatControllerContext();
  if (!selected) return <DraftPanelEmpty />;
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
      parentThinkingLevel={sessionThinkingLevel(turnThinkingLevel, agentThinkingLevel)}
    />
  );
}
