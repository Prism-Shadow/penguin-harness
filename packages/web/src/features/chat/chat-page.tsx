import { useState } from "react";
import { Skeleton, WallpaperSurface } from "@prismshadow/penguin-ui";
import { useChatController } from "./session/use-chat-controller";
import { createMainChatView } from "./body/main-chat-view";
import { renderMainChatToolbar } from "./toolbar/main-chat-toolbar";
import { renderMainChatBody } from "./body/main-chat-body";
import { renderMainChatDialogs } from "./session/main-chat-dialogs";

/** Composition only: one controller, original guard, exact main render fragments. */
export function ChatPage() {
  const controller = useChatController();
  /** The session tabs that currently cover the page below their strip (a shown workbench). */
  const [coveredTabs, setCoveredTabs] = useState<ReadonlySet<string>>(() => new Set());
  const onCoveredChange = (id: string) => (covered: boolean) =>
    setCoveredTabs((prev) => {
      if (prev.has(id) === covered) return prev;
      const next = new Set(prev);
      if (covered) next.add(id);
      else next.delete(id);
      return next;
    });
  const { projectId, pageAgentId } = controller;
  if (!projectId || (!controller.draft && !pageAgentId)) {
    return (
      <div className="p-6">
        <Skeleton className="h-6 w-64" />
      </div>
    );
  }
  /**
   * The class for what a shown session tab covers: the toolbar and everything under it. It stays
   * mounted and laid out, so nothing reflows or refits, but it is not painted and takes no pointer.
   * The cover's own z-index cannot do that: the docks paint layers above the page (the bottom
   * dock's boundary handle straddling its top edge, a fullscreen surface and the handle on its
   * leading edge), and each of them showed through the page — the handle as a line that lit up
   * under the pointer, took the cursor and resized the hidden dock.
   */
  const coveredByWorkbench = coveredTabs.size > 0 ? "invisible" : "";
  const view = createMainChatView({
    ...controller,
    projectId,
    pageAgentId,
    coveredByWorkbench,
  });
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
              onCoveredChange={onCoveredChange(id)}
            />
          ))}
      </>
      {renderMainChatToolbar(view)}
      {renderMainChatBody(view)}
      {renderMainChatDialogs(view)}
    </WallpaperSurface>
  );
}
