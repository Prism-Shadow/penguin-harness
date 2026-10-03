/**
 * The conversation a dock panel is docked beside, as the panel bodies read it. The chat page
 * provides it (features/chat/session/chat-session-context.tsx); the bodies are contributed by other
 * modules (features/dock/iface.ts), some of which chat imports in turn, so the context is a library
 * rather than an export of chat's. It carries what those bodies use and nothing more.
 */
import { createContext, useContext } from "react";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import type { ComposerReference } from "./workspace-tree";

export interface ChatSession {
  projectId: string | null;
  /** The open conversation; null on the draft page and while the route is still resolving. */
  selected: SessionInfo | null;
  /** The page is a draft: `/chat/new` or a parked draft. */
  draft: boolean;
  /** The folder the draft has picked and its machine; null for a temporary Workspace. */
  draftWorkspace: { path: string; machineId: string | null } | null;
  /** The Files panel's jump command: locate this Workspace file (a fresh object per jump). */
  fileOpenRequest: { path: string } | null;
  /** Bumped every time a Task settles on the open conversation: the panels' reload cue. */
  settledTurnSignal: number;
  /** Adds a file or an excerpt to the composer as a reference chip. */
  addComposerReference(reference: ComposerReference): void;
  /** Puts text into the composer for the user to edit and send. */
  prefillComposer(text: string): void;
}

export const ChatSessionContext = createContext<ChatSession | null>(null);

/** A React hook: the conversation the calling panel is docked beside. */
export function useChatSession(): ChatSession {
  const session = useContext(ChatSessionContext);
  if (session === null) throw new Error("useChatSession() called outside the chat page");
  return session;
}
