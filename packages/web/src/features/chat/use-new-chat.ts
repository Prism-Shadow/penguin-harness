/**
 * The generic "New chat" as one hook, so every entry point that names nothing — the collapsed
 * rail's entry, the `chat.new` shortcut — does what the sidebar's pinned button does: park any
 * typed-but-unsent draft text and release a text-less draft's leftover selections
 * (prepareNewChatDraft, which says why every entry point must), then open the draft page, which
 * starts on the Project's new-chat defaults.
 */
import { useCallback } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../../state/auth";
import { useProject } from "../../state/project";
import { DRAFT_SESSION_ID } from "./chat-page";
import { prepareNewChatDraft } from "./new-chat";

export function useNewChat(): () => void {
  const { user } = useAuth();
  const { currentProject } = useProject();
  const navigate = useNavigate();
  const userId = user?.userId ?? null;
  const projectId = currentProject?.projectId ?? null;
  return useCallback(() => {
    if (userId !== null && projectId !== null) prepareNewChatDraft(userId, projectId);
    navigate(`/chat/${DRAFT_SESSION_ID}`);
  }, [userId, projectId, navigate]);
}
