import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { toastError } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { forgetSession } from "../../lib/session-seen";
import { apiErrorText } from "../../lib/api-error";
import { removePinnedSession, savePinnedSessions } from "./pinned-sessions";
import { removeFromSessionOrder, saveSessionOrder } from "../../lib/session-order";
import {
  DRAFT_SESSION_ID,
  clearDraft,
  sessionDraftKey,
  removeDraftSession,
  prepareNewChatDraft,
} from "../chat";
import { docksOnScreen, openPanel, dockWorkspace } from "../dock";
import type { useMainSidebarFetchScope } from "./main-sidebar-fetch-scope";

/** Consecutive live main statements 116..122, called once in original hook order. */
export function useMainSidebarArchiveSession(scope: ReturnType<typeof useMainSidebarFetchScope>) {
  const {
    navigate,
    user,
    setCurrentAgentId,
    remove,
    replace,
    activeSessionId,
    byAgent,
    currentProjectId,
    groupMode,
    pinnedSessions,
    setPinnedSessions,
    sessionOrder,
    setSessionOrder,
    deletingSession,
    setDeletingSession,
    setDeletingBusy,
    deletingDraft,
    setDeletingDraft,
    renamingSession,
    setRenamingSession,
    renameText,
    setRenameBusy,
    setRenameError,
    onNavigate,
  } = scope;

  /**
   * Archive: persists immediately and moves the row out of the list in place (fails silently;
   * the next list refresh self-corrects). Archiving the conversation on screen leaves it for a
   * new chat, as the New chat button does — it is filed away, not something to read on; only
   * its URL, opened again later, shows the archived stub.
   */
  const archiveSession = async (s: SessionInfo) => {
    try {
      const res = await api.patchSession(s.sessionId, { archived: true });
      // Leave first, so the page never paints the stub for the row it is about to drop.
      if (activeSessionId === s.sessionId) newChat();
      replace(res.session);
    } catch {
      /* Ignore: non-critical operation */
    }
  };

  const confirmRename = async () => {
    if (!renamingSession) return;
    const title = renameText.trim();
    if (!title) return;
    setRenameBusy(true);
    setRenameError(null);
    try {
      const res = await api.patchSession(renamingSession.sessionId, { title });
      replace(res.session);
      setRenamingSession(null);
    } catch (e) {
      setRenameError(apiErrorText(e));
    } finally {
      setRenameBusy(false);
    }
  };

  const confirmDeleteSession = async () => {
    if (!deletingSession) return;
    setDeletingBusy(true);
    const target = deletingSession;
    try {
      await api.deleteSession(target.sessionId);
      // remove() also tombstones the id (see the store's isDeleted), which is what keeps the
      // chat page from re-fetching the Session it is still routed at during the frames before
      // the navigate() below lands. Ordering the two is deliberately NOT the mechanism: the
      // list lives in a zustand store whose updates are not subject to React's transition
      // lanes, so scheduling tricks here cannot be relied on to sequence them.
      remove(target.sessionId);
      // The session is gone, so clear its input draft too (no orphaned keys left in localStorage; keys are scoped per user, #68).
      if (user) clearDraft(sessionDraftKey(user.userId, target.sessionId));
      // Prune its pin and manual-order entry as well (both helpers return the same
      // reference when the id wasn't present — the write is skipped then).
      const prunedPins = removePinnedSession(pinnedSessions, target.sessionId);
      if (prunedPins !== pinnedSessions) {
        setPinnedSessions(prunedPins);
        savePinnedSessions(currentProjectId, prunedPins);
      }
      forgetSession(currentProjectId, target.sessionId);
      const prunedOrder = removeFromSessionOrder(sessionOrder, target.sessionId);
      if (prunedOrder !== sessionOrder) {
        setSessionOrder(prunedOrder);
        saveSessionOrder(currentProjectId, groupMode, prunedOrder);
      }
      setDeletingSession(null);
      // The deleted session was the one open: jump to this Agent's next conversation, otherwise
      // fall back to the chat home page. Only a conversation of this list is auto-opened —
      // never an archived one (filed away — landing there would look like the chat vanished
      // into thin air), the rule latestConversation follows.
      if (activeSessionId === target.sessionId) {
        const rest = (byAgent.get(target.agentId) ?? []).filter(
          (s) => s.sessionId !== target.sessionId,
        );
        navigate(rest[0] ? `/chat/${rest[0].sessionId}` : "/chat");
      }
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setDeletingBusy(false);
    }
  };

  const go = (to: string) => {
    navigate(to);
    onNavigate?.();
  };

  /**
   * New chat: enters draft state (/chat/new) without creating a Session — Model / Workspace /
   * approval mode are all chosen on the draft input card, and the Session is only actually
   * created when the first message is sent. Route state carries only what the clicked entry
   * is about: the agent-mode group header's "+" names that group's Agent, the workspace-mode
   * group header's "+" names that group's Workspace path ("" = a temporary workspace), and the
   * pinned "New chat" and the header's create button name nothing. Every field left unnamed
   * starts on the Project's new-chat defaults, then the built-in fallback (new-chat.ts).
   */
  const newChat = ({
    agentId,
    workspace,
    machineId,
    browseFiles,
  }: { agentId?: string; workspace?: string; machineId?: string; browseFiles?: boolean } = {}) => {
    // Typed-but-unsent text in the ACTIVE new-chat draft becomes a parked draft
    // conversation first (a row in the list below, sendable anytime — draft-sessions.ts),
    // so this click always lands on an empty composer and never silently shelves content;
    // the selections a text-less earlier visit left behind are released with it.
    if (user && currentProjectId) prepareNewChatDraft(user.userId, currentProjectId);
    if (agentId) setCurrentAgentId(agentId);
    const state = {
      ...(agentId ? { agentId } : {}),
      // The machine travels WITH the path, always — including its absence. A path names a
      // different directory on every machine, so handing the composer one without the other
      // is handing it a directory it cannot find.
      ...(workspace !== undefined ? { workspace, machineId } : {}),
      // The chat page opens the dock's Files panel on arrival (a group's "Browse files").
      ...(browseFiles === true ? { browseFiles } : {}),
    };
    navigate(`/chat/${DRAFT_SESSION_ID}`, Object.keys(state).length > 0 ? { state } : undefined);
    onNavigate?.();
  };

  /**
   * A Workspace group's "Browse files": the dock's Files panel on that directory. A page already
   * on it — the open conversation's Workspace, or the folder the draft picked, on the same
   * machine — only brings the panel up. Anywhere else lands on a new-chat draft for the folder,
   * the group's "+", whose Files panel is addressed by the directory itself: the dock belongs to
   * the conversation on screen, so a folder another conversation is in has no panel here.
   */
  const browseFiles = (path: string, machineId: string | null) => {
    const here = dockWorkspace();
    if (docksOnScreen() && here !== null && here.path === path && here.machineId === machineId) {
      openPanel("workspace");
      onNavigate?.();
      return;
    }
    newChat({ workspace: path, ...(machineId ? { machineId } : {}), browseFiles: true });
  };

  /** Confirmed parked-draft deletion: drops the entry; a deleted draft that is open falls back to the plain new-chat page. */
  const confirmDeleteDraft = () => {
    if (!deletingDraft) return;
    if (user && currentProjectId) {
      removeDraftSession(user.userId, currentProjectId, deletingDraft.id);
    }
    if (activeSessionId === deletingDraft.id) navigate(`/chat/${DRAFT_SESSION_ID}`);
    setDeletingDraft(null);
  };
  return {
    ...scope,
    archiveSession,
    confirmRename,
    confirmDeleteSession,
    go,
    newChat,
    browseFiles,
    confirmDeleteDraft,
  };
}
