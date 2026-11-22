import { useEffect } from "react";
import { AppWindow, Skeleton, WallpaperSurface, WindowStack } from "@prismshadow/penguin-ui";
import { publishPageAgent } from "../../lib/page-agent";
import { useChatController } from "./session/use-chat-controller";
import { createMainChatView } from "./body/main-chat-view";
import { renderMainChatToolbar } from "./toolbar/main-chat-toolbar";
import { VoiceScope } from "./voice/voice-scope";
import { renderMainChatBody } from "./body/main-chat-body";
import { renderMainChatDialogs } from "./session/main-chat-dialogs";

/** Composition only: one controller, original guard, exact main render fragments. */
export function ChatPage() {
  const controller = useChatController();
  const { projectId, pageAgentId, pageMachineId } = controller;
  // The sidebar's app list follows the Agent this page renders under, on the server it lives on:
  // a conversation on a machine runs that machine's copy (lib/page-agent.ts).
  useEffect(
    () =>
      projectId && pageAgentId
        ? publishPageAgent({ projectId, agentId: pageAgentId, machineId: pageMachineId })
        : undefined,
    [projectId, pageAgentId, pageMachineId],
  );
  if (!projectId || (!controller.draft && !pageAgentId)) {
    return (
      <div className="p-6">
        <Skeleton className="h-6 w-64" />
      </div>
    );
  }
  const view = createMainChatView({
    ...controller,
    projectId,
    pageAgentId,
  });
  return (
    // bg-canvas: the chat column is the page, so it takes the theme's page colour — white and
    // gray-950 in Primer, exactly what it painted before; paper in Console, the sheet in Frost —
    // and the transcript's sticky rows, painted in the same token, sit on it without a seam.
    <WallpaperSurface className="flex h-full flex-col bg-canvas">
      <WindowStack>
        {/* The Chat window, the page's only one: its own stacking context, so a dock lifted to
            fullscreen and its handles order among themselves. data-dock-host: the docks' edge
            bands, drop preview and the bottom dock's height ratio all measure it
            (dock-drag.tsx / dock-panel.tsx). */}
        <AppWindow shown data-dock-host>
          {renderMainChatToolbar(view)}
          <VoiceScope
            projectId={projectId}
            server={pageMachineId}
            sessionId={controller.draft ? undefined : controller.selected?.sessionId}
            active
          >
            {renderMainChatBody(view)}
          </VoiceScope>
        </AppWindow>
      </WindowStack>
      {renderMainChatDialogs(view)}
    </WallpaperSurface>
  );
}
