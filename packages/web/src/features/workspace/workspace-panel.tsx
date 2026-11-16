/**
 * The Files panel (`DockModule.panels`, kind `workspace`): the open conversation's Workspace.
 * The draft's panel browses the folder picked in the composer, addressed by the directory itself;
 * a temporary Workspace has none yet. Not keyed by Session: the browser re-binds through its
 * props, and its own handled-once request guard is what the conversation-switch e2e covers — so
 * both branches below render the same element, which carries over from draft to conversation.
 */
import { DraftPanelEmpty } from "../../lib/dock-panel-empty";
import { useChatSession } from "../../lib/chat-session";
import { S } from "../../lib/strings";
import { WorkspaceBrowser } from "./workspace-browser";

export function WorkspacePanel({ active }: { active: boolean }) {
  const {
    projectId,
    selected,
    draft,
    draftWorkspace,
    fileOpenRequest,
    settledTurnSignal,
    addComposerReference,
  } = useChatSession();
  if (!selected && draft && projectId) {
    return draftWorkspace !== null ? (
      <WorkspaceBrowser
        scope={{
          kind: "workspace",
          projectId,
          workspace: draftWorkspace.path,
          machineId: draftWorkspace.machineId,
        }}
        active={active}
        onAddReference={addComposerReference}
      />
    ) : (
      <DraftPanelEmpty description={S.files.draftTemporary} />
    );
  }
  if (!selected) return <DraftPanelEmpty />;
  return (
    <WorkspaceBrowser
      scope={{ kind: "session", sessionId: selected.sessionId }}
      openRequest={fileOpenRequest}
      active={active}
      reloadSignal={settledTurnSignal}
      onAddReference={addComposerReference}
    />
  );
}
