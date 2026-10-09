/**
 * What the chat page hands its dock panels. A dock renders every panel the same way — the
 * registered Body with its `active` flag and nothing else — but the built-in bodies
 * (builtin-dock-panels.tsx) show the conversation on screen, and that state is the page's:
 * the selected Session, the stream, the jump commands the transcript issues, and the
 * composer's entry points. The page provides it once around both docks; a body reads it with
 * useChatDock.
 */
import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { ModelsResponse, SessionInfo } from "@prismshadow/penguin-server/api";
import type { PermissionPick } from "../../lib/permission-level";
import type { StreamModel } from "../../lib/omni/stream-model";
import type { MemoryChangeRow, MemoryLocateTarget } from "../../lib/omni/memory-changes";
import type { ComposerReference } from "../../lib/workspace-tree";
import type { StreamRenderContext } from "./message-stream";
import type { SessionStreamState } from "./use-session-stream";
import type { useMemoryListing } from "./use-memory-listing";

export interface ChatDockState {
  /** The conversation on screen; null on the draft page and while none is selected (yet). */
  selected: SessionInfo | null;
  /** The new-chat draft (`/chat/new`) or a parked draft is on screen. */
  draft: boolean;
  /**
   * The folder the draft has picked, and its machine — what the Files panel browses while
   * there is no Session to address it by. Null for a temporary Workspace.
   */
  draftWorkspace: { path: string; machineId: string | null } | null;
  projectId: string | null;
  /** The subagents panel's model view: the live model with the backfilled windows merged in. */
  panelModel: StreamModel;
  /** The stream's repaint signal, its run state and the runtime's live subagent children. */
  stream: Pick<SessionStreamState, "version" | "taskState" | "subagents">;
  /** The main conversation's render context (origin []); a child conversation derives its own. */
  ctx: StreamRenderContext;
  /** Jump command: select this child conversation in the agents tab. */
  subagentFocus: { sessionId: string; origin: string[] } | null;
  /** The Task the agents tab shows: null = the latest; an anchor pins the one with that child. */
  subagentTaskScope: { anchorSessionId: string } | null;
  models: ModelsResponse | null;
  /** A permission pick: the approval mode and the Session's sandbox, saved in one PATCH. */
  onChangePermission: (pick: PermissionPick) => void | Promise<unknown>;
  /** An approval-mode or sandbox save is in flight. */
  modeSaving: boolean;
  /** The Session's effective thinking level ("" = unknown): a child composer's display fallback. */
  parentThinkingLevel: string;
  /** Jump command: locate this Workspace file in the Files tab. */
  fileOpenRequest: { path: string } | null;
  /** Bumped every time a Task settles on this Session: "re-read" for the Files and Trace tabs. */
  settledTurnSignal: number;
  /** Stages a file, a directory or a quoted range in this conversation's composer as a chip. */
  addComposerReference: (reference: ComposerReference) => void;
  /** This conversation's memory changes, the same array while their content is unchanged. */
  sessionMemoryChanges: MemoryChangeRow[];
  /** The Agent's memory listing, shared with the memory-changes card's deleted-row marking. */
  memoryListing: ReturnType<typeof useMemoryListing>;
  /** Jump command: land the Memory tab on this memory's detail, or on the list (null target). */
  memoryRequest: { target: MemoryLocateTarget | null } | null;
  /** Opens this Agent's settings on the memory tab, where add / edit / delete live. */
  openMemorySettings: (agentId: string) => void;
  /** Writes a prompt into this conversation's composer and stops there: nothing is sent. */
  prefillComposer: (text: string) => void;
}

const ChatDockContext = createContext<ChatDockState | null>(null);

/**
 * Provides the chat page's dock state to the panel bodies below it. A context provider adds
 * no element, so it can span the chat row and the bottom dock after it without touching the
 * layout.
 */
export function ChatDockProvider({
  value,
  children,
}: {
  value: ChatDockState;
  children: ReactNode;
}) {
  return <ChatDockContext.Provider value={value}>{children}</ChatDockContext.Provider>;
}

export function useChatDock(): ChatDockState {
  const ctx = useContext(ChatDockContext);
  if (!ctx) throw new Error("useChatDock must be used within a ChatDockProvider");
  return ctx;
}
