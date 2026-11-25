import { useContext } from "react";
import { PageIdentity } from "../../lib/page-focus";
import { EmptyState, ICONS } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { panelLabel } from "@prismshadow/penguin-library-session/web";
import type { DockPanelBodyProps, PanelId } from "@prismshadow/penguin-library-session/web";

import { WorkspaceBrowser } from "./index";
import { useChatSession } from "../../lib/chat-session";
function draftPlaceholder(id: PanelId) {
  return (
    <EmptyState
      title={panelLabel(id)}
      // The schedules tab says what the first message unlocks; the other tabs share one line.
      description={id === "schedules" ? S.schedule.panelDraftEmpty : S.dock.draftEmpty}
    />
  );
}
function WorkspacePanelBody({ active, scope }: DockPanelBodyProps) {
  const host = useContext(PageIdentity)?.sessionHost;
  const {
    selected,
    draft,
    draftWorkspace,
    projectId,
    fileOpenRequest,
    settledTurnSignal,
    addComposerReference,
  } = useChatSession();
  // The draft's Files panel browses the folder picked in the composer, addressed by the
  // directory itself; a temporary Workspace has none yet.
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
      <EmptyState title={panelLabel("workspace")} description={S.files.draftTemporary} />
    );
  }
  if (!selected) return draftPlaceholder("workspace");
  return (
    <WorkspaceBrowser
      scope={{
        kind: "session",
        sessionId: selected.sessionId,
        machineId: scope ? scope.machineId : host?.machineId,
      }}
      workspacePath={selected.workspace}
      openRequest={fileOpenRequest}
      active={active}
      reloadSignal={settledTurnSignal}
      onAddReference={selected.archived ? undefined : addComposerReference}
    />
  );
}
export const mainPanelDefinition = {
  id: "workspace",
  label: () => S.chat.workspacePanel,
  glyph: ICONS.folder,
  order: 20,
  Body: WorkspacePanelBody,
};
