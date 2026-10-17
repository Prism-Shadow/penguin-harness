import { useCallback } from "react";
import { sessionThinkingLevel } from "../../model-picker";
import { useDockMount, closedDockView, dockViews } from "../../dock";
import type { ChatDockState } from "../chat-dock-context";
import { terminalApiSupported } from "../../terminal";
import type { useMainChatActions } from "./main-chat-actions";

/**
 * An Agent's settings page, on one tab: this server's Agent, or with `machineId` the Agent of
 * that id on that machine, which the page reads and writes over there (`?machine=`).
 */
export function agentPagePath(agentId: string, machineId: string | null, tab: string): string {
  const params = new URLSearchParams();
  if (machineId !== null) params.set("machine", machineId);
  params.set("tab", tab);
  return `/agents/${encodeURIComponent(agentId)}?${params.toString()}`;
}

/** Exact consecutive main ChatPage statements 164..169; called once, in original order. */
export function useMainChatDock(scope: ReturnType<typeof useMainChatActions>) {
  const {
    navigate,
    projectId,
    modeSaving,
    models,
    fileOpenRequest,
    memoryRequest,
    subagentFocus,
    subagentTaskScope,
    draft,
    draftWorkspace,
    selected,
    stream,
    panelModel,
    sessionMemoryChanges,
    memoryListing,
    turnThinkingLevel,
    agentThinkingLevel,
    settledTurnSignal,
    prefillComposer,
    addComposerReference,
    onChangePermission,
    ctx,
  } = scope;

  // The docks to render: right beside the chat row, bottom below it (the narrow merged
  // view arrives as a bottom view). They render on the draft page too — the arrangement is
  // the user's workbench, and a terminal opened while drafting must be visible — with the
  // session-bound panels showing a placeholder until the first send creates the Session.
  // useDockMount keeps a closing dock mounted through its collapse transition and then
  // holds it at zero size on closedDockView, so hiding a dock costs none of what its panels
  // hold; it skips the animation for instant changes (scope switches, cross-dock moves).
  // Narrow: the merged view is a bottom view, and the closed one goes to the same mount.
  const views = dockViews();
  const rightMount = useDockMount(
    views.find((view) => view.position === "right") ?? null,
    closedDockView("right"),
  );
  const bottomMount = useDockMount(
    views.find((view) => view.position === "bottom") ?? null,
    closedDockView("bottom"),
  );
  const terminalSupported = terminalApiSupported();

  // The Memory panel's way to its management: add / edit / delete live on the Agent's
  // settings page, on the memory tab — the page of the Agent on the machine the conversation
  // is on.
  const openMemorySettings = useCallback(
    (memoryAgentId: string, machineId: string | null) =>
      navigate(agentPagePath(memoryAgentId, machineId, "memory")),
    [navigate],
  );
  /**
   * What the dock panel bodies read off this page (builtin-dock-panels.tsx), provided around
   * both docks below. Not memoised: `ctx` is rebuilt on every render and the stream fields
   * move with every version, so a memo would miss every time; the bodies re-render with the
   * page, exactly as they did when the page built them inline. The callbacks in it are the
   * page's own memoised ones, passed as they are, never wrapped afresh.
   */
  const chatDock: ChatDockState = {
    selected,
    draft,
    draftWorkspace,
    projectId,
    panelModel,
    stream,
    ctx,
    subagentFocus,
    subagentTaskScope,
    models,
    onChangePermission,
    modeSaving,
    parentThinkingLevel: sessionThinkingLevel(turnThinkingLevel, agentThinkingLevel),
    fileOpenRequest,
    settledTurnSignal,
    addComposerReference,
    sessionMemoryChanges,
    memoryListing,
    memoryRequest,
    openMemorySettings,
    prefillComposer,
  };
  return {
    ...scope,
    views,
    rightMount,
    bottomMount,
    terminalSupported,
    openMemorySettings,
    chatDock,
  };
}
