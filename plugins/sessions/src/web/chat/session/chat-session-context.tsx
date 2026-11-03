/**
 * The conversation on screen, handed to the dock panels docked beside it. The page's controller
 * (use-chat-controller.ts) is the source: `ChatSessionProvider` gives every panel the slice in
 * lib/chat-session.ts (`useChatSession()`), and chat's own two panels — the agents and the memory
 * — the whole controller (`useChatControllerContext()`), which no other module reads.
 */
import { createContext, useContext, type ReactNode } from "react";

import { ChatSessionContext, type ChatSession } from "../../../lib/chat-session";

import type { ChatController } from "./use-chat-controller";

const ControllerContext = createContext<ChatController | null>(null);

export function ChatSessionProvider({
  controller,
  children,
}: {
  controller: ChatController;
  children: ReactNode;
}) {
  const session: ChatSession = {
    projectId: controller.projectId,
    selected: controller.selected,
    draft: controller.draft,
    draftWorkspace: controller.draftWorkspace,
    fileOpenRequest: controller.fileOpenRequest,
    settledTurnSignal: controller.settledTurnSignal,
    addComposerReference: controller.addComposerReference,
    prefillComposer: controller.prefillComposer,
  };
  return (
    <ControllerContext.Provider value={controller}>
      <ChatSessionContext.Provider value={session}>{children}</ChatSessionContext.Provider>
    </ControllerContext.Provider>
  );
}

/** A React hook for chat's own panels: the page's whole controller. */
export function useChatControllerContext(): ChatController {
  const controller = useContext(ControllerContext);
  if (controller === null) throw new Error("rendered outside the chat page");
  return controller;
}
