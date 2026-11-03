import { Skeleton, WallpaperSurface } from "@prismshadow/penguin-ui";
import { useChatController } from "./session/use-chat-controller";
import { createMainChatView } from "./body/main-chat-view";
import { renderMainChatToolbar } from "./toolbar/main-chat-toolbar";
import { renderMainChatBody } from "./body/main-chat-body";
import { renderMainChatDialogs } from "./session/main-chat-dialogs";

/** Composition only: one controller, original guard, exact main render fragments. */
export function ChatPage() {
  const controller = useChatController();
  const { projectId, pageAgentId } = controller;
  if (!projectId || (!controller.draft && !pageAgentId)) {
    return (
      <div className="p-6">
        <Skeleton className="h-6 w-64" />
      </div>
    );
  }
  const view = createMainChatView({ ...controller, projectId, pageAgentId });
  const { sessionTabs, workflowMachineId } = view;
  return (
    <WallpaperSurface data-dock-host className="relative flex h-full flex-col bg-canvas">
      <>
        {projectId !== null &&
          pageAgentId !== null &&
          sessionTabs.map(({ id, Tab }) => (
            <Tab
              key={id}
              projectId={projectId}
              agentId={pageAgentId}
              machineId={workflowMachineId}
            />
          ))}
      </>
      {renderMainChatToolbar(view)}
      {renderMainChatBody(view)}
      {renderMainChatDialogs(view)}
    </WallpaperSurface>
  );
}
