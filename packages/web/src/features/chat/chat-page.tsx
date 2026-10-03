import { Skeleton, WallpaperSurface } from "@prismshadow/penguin-ui";
import { WorkbenchFrame, WorkbenchTabStrip } from "../workbenches";
import { useChatSession } from "./session/use-chat-session";
import { createMainChatView } from "./body/main-chat-view";
import { renderMainChatToolbar } from "./toolbar/main-chat-toolbar";
import { renderMainChatBody } from "./body/main-chat-body";
import { renderMainChatDialogs } from "./session/main-chat-dialogs";

/** Composition only: one controller, original guard, exact main render fragments. */
export function ChatPage() {
  const controller = useChatSession();
  const { projectId, pageAgentId } = controller;
  if (!projectId || (!controller.draft && !pageAgentId)) {
    return (
      <div className="p-6">
        <Skeleton className="h-6 w-64" />
      </div>
    );
  }
  const view = createMainChatView({ ...controller, projectId, pageAgentId });
  const { workflowTabs } = view;
  return (
    <WallpaperSurface data-dock-host className="relative flex h-full flex-col bg-canvas">
      <WorkbenchTabStrip
        tabs={workflowTabs.tabs}
        notices={workflowTabs.notices}
        active={workflowTabs.active}
        onSelect={workflowTabs.setActive}
      />
      {workflowTabs.activeTab !== null && projectId !== null && pageAgentId !== null && (
        <div className="absolute inset-x-0 bottom-0 top-9 z-10">
          <WorkbenchFrame
            // Per tab: the frame keeps this workflow's history fold, its error and its
            // armed Remove, and none of that belongs to the next tab.
            key={workflowTabs.activeTab.tabId}
            projectId={projectId}
            agentId={pageAgentId}
            tab={workflowTabs.activeTab}
            onChanged={() => void workflowTabs.refresh()}
            onRemoved={() => {
              workflowTabs.setActive(null);
              void workflowTabs.refresh();
            }}
          />
        </div>
      )}
      {renderMainChatToolbar(view)}
      {renderMainChatBody(view)}
      {renderMainChatDialogs(view)}
    </WallpaperSurface>
  );
}
