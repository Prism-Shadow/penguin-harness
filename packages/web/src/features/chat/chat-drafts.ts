/**
 * The chat module's `ChatDrafts` (iface.ts): the draft files' operations behind one object, so the
 * session list and the shell reach them through the module tree instead of importing them.
 */
import { useMemo } from "react";
import { DRAFT_SESSION_ID } from "./chat-page";
import { clearDraft, sessionDraftKey } from "./draft-cache";
import { draftSessionTitle, removeDraftSession, useDraftSessions } from "./draft-sessions";
import { prepareNewChatDraft } from "./new-chat";
import { useNewChat } from "./use-new-chat";
import type { ChatDrafts, ParkedDraft } from "./iface";

export const chatDrafts: ChatDrafts = {
  newChatId: DRAFT_SESSION_ID,
  useParked(userId, projectId) {
    const entries = useDraftSessions(userId, projectId);
    // Keyed on the store's array, which only changes when the list does.
    return useMemo(
      (): readonly ParkedDraft[] =>
        entries.map((entry) => ({ id: entry.id, title: draftSessionTitle(entry) })),
      [entries],
    );
  },
  removeParked: (userId, projectId, id) => removeDraftSession(userId, projectId, id),
  forgetSession: (userId, sessionId) => clearDraft(sessionDraftKey(userId, sessionId)),
  prepareNewChat: (userId, projectId) => {
    prepareNewChatDraft(userId, projectId);
  },
  useNewChat,
};
