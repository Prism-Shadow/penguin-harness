import { useEffect, useMemo, useState } from "react";
import { AppWindow, Skeleton, WallpaperSurface, WindowStack } from "@prismshadow/penguin-ui";
import { setDockRevealer } from "../dock";
import { useChatController } from "./session/use-chat-controller";
import { createMainChatView } from "./body/main-chat-view";
import { renderMainChatToolbar } from "./toolbar/main-chat-toolbar";
import { renderMainChatBody } from "./body/main-chat-body";
import { renderMainChatDialogs } from "./session/main-chat-dialogs";

/** Composition only: one controller, original guard, exact main render fragments. */
export function ChatPage() {
  const controller = useChatController();
  /** The session tabs whose window is shown over Chat, each with how to show Chat again. */
  const [shownOver, setShownOver] = useState<ReadonlyMap<string, () => void>>(() => new Map());
  // One stable report per tab: a fresh function each render would re-run the tab's report
  // effect on every render of this page, and each report renders the page again.
  const { sessionTabs } = controller;
  const tabs = useMemo(
    () =>
      sessionTabs.map(({ id, Tab }) => ({
        id,
        Tab,
        report: (showChat: (() => void) | null) =>
          setShownOver((prev) => {
            if ((prev.get(id) ?? null) === showChat) return prev;
            const next = new Map(prev);
            if (showChat === null) next.delete(id);
            else next.set(id, showChat);
            return next;
          }),
      })),
    [sessionTabs],
  );
  /** Where the tabs' own windows mount: beside Chat, in the area under the strips. */
  const [windows, setWindows] = useState<HTMLElement | null>(null);
  const chatShown = shownOver.size === 0;
  // A dock shortcut pressed while a tab's window is up brings Chat back first, then does what
  // it does there (dock-reveal.ts).
  useEffect(
    () =>
      chatShown
        ? undefined
        : setDockRevealer(() => {
            for (const showChat of shownOver.values()) showChat();
          }),
    [chatShown, shownOver],
  );
  const { projectId, pageAgentId } = controller;
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
  const { workflowMachineId } = view;
  return (
    // bg-canvas: the chat column is the page, so it takes the theme's page colour — white and
    // gray-950 in Primer, exactly what it painted before; paper in Console, the sheet in Frost —
    // and the transcript's sticky rows, painted in the same token, sit on it without a seam. Both
    // windows below sit on it: a workbench page that paints no background of its own shows the
    // same surface the chat does.
    <WallpaperSurface className="flex h-full flex-col bg-canvas">
      {/* Session tabs: the Agent's own pages beside the chat. Each draws its strip here (nothing
          while it has no tab) and its window in the area below, beside Chat — the toolbar, the
          transcript, the composer and the docks. Chat stays mounted under a tab's window,
          unpainted and inert (AppWindow), so nothing in it reflows and its scroll and docks are
          as they were on the way back. */}
      {projectId !== null &&
        pageAgentId !== null &&
        tabs.map(({ id, Tab, report }) => (
          <Tab
            key={id}
            projectId={projectId}
            agentId={pageAgentId}
            machineId={workflowMachineId}
            windows={windows}
            onWindowShown={report}
          />
        ))}
      <WindowStack>
        {/* The Chat window. data-dock-host: the docks' edge bands, drop preview and the bottom
            dock's height ratio all measure it (dock-drag.tsx / dock-panel.tsx). */}
        <AppWindow shown={chatShown} data-dock-host>
          {renderMainChatToolbar(view)}
          {renderMainChatBody(view)}
        </AppWindow>
        {/* The session tabs' windows (SessionTabProps.windows): no box of its own, so each
            window covers the stack like Chat does. */}
        <div ref={setWindows} className="contents" />
      </WindowStack>
      {renderMainChatDialogs(view)}
    </WallpaperSurface>
  );
}
