/**
 * The bridge from a "Create with AI" surface into a new conversation. The prompt is written into
 * the active new-chat draft (the cache draft-view reads on mount), the requested agent becomes
 * the current one, and the route jumps to the draft page with the request in location.state.
 * `autoSend` asks draft-view to submit the prefilled draft as soon as its send preconditions
 * hold (draft-view's auto-send effect); without it the draft is only prefilled.
 *
 * Typed-but-unsent text in the active draft is parked first (draft-sessions.ts) rather than
 * overwritten by the canned prompt, and the model selection carries over, as it does across
 * sends. The composed prompt itself is written as `aiPrefill` (draft-cache.ts) so that it dies
 * with the draft it seeds: nobody typed it, so it is never parked in turn, and leaving the draft
 * page without editing or sending it clears the slot.
 */
import { useCallback } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../../state/auth";
import { useProject } from "../../state/project";
import { DRAFT_SESSION_ID } from "../chat/chat-page";
import { draftKey, loadDraft, saveDraft } from "../chat/draft-cache";
import type { DraftCache } from "../chat/draft-cache";
import { parkActiveDraft } from "../chat/draft-sessions";

export interface AiChatRequest {
  /** The agent that does the work (normally pickDefaultAgent's choice). */
  agentId: string;
  /** The whole prompt, instruction tail included (composeAiPrompt). */
  text: string;
  /** Pins the draft's Workspace ("" is the temporary Workspace); absent, the draft keeps its cached choice. */
  workspace?: string;
  /** Skills to preselect in the composer; absent or empty clears a stale selection. */
  skills?: string[];
  /** Submit the draft on arrival instead of leaving it in the composer. */
  autoSend?: boolean;
}

/** What the draft page finds in `location.state` after openAiChat. */
export interface AiChatRouteState {
  agentId: string;
  workspace?: string;
  autoSend?: true;
}

/**
 * The draft cache entry for a request, merged over what the active slot holds so the model
 * carry-over survives. A leftover `/agent` handoff chip is dropped: it would forward the prompt
 * to a different agent than the one named here. The text is marked as composed rather than typed
 * (`aiPrefill`, see draft-cache.ts), which is what keeps it from outliving the draft it seeds.
 */
export function buildAiDraft(existing: DraftCache, req: AiChatRequest): DraftCache {
  const draft: DraftCache = {
    ...existing,
    agentId: req.agentId,
    text: req.text,
    skills: req.skills ?? [],
    aiPrefill: true,
  };
  if (req.workspace !== undefined) draft.workspace = req.workspace;
  delete draft.handoffAgentId;
  return draft;
}

/** The route state carried to the draft page: only what was asked for, so a plain request leaves no `autoSend` key behind. */
export function aiChatRouteState(req: AiChatRequest): AiChatRouteState {
  return {
    agentId: req.agentId,
    ...(req.workspace !== undefined ? { workspace: req.workspace } : {}),
    ...(req.autoSend ? { autoSend: true as const } : {}),
  };
}

export function useAiBridge(): { openAiChat: (req: AiChatRequest) => void } {
  const navigate = useNavigate();
  const userId = useAuth().user?.userId ?? null;
  const { currentProject, setCurrentAgentId } = useProject();
  const projectId = currentProject?.projectId ?? null;
  const openAiChat = useCallback(
    (req: AiChatRequest) => {
      // Without a user or Project there is no account-scoped cache slot to write; the jump still
      // happens, landing on an empty draft for the agent.
      if (userId && projectId) {
        parkActiveDraft(userId, projectId);
        const key = draftKey(userId, projectId);
        saveDraft(key, buildAiDraft(loadDraft(key), req));
      }
      setCurrentAgentId(req.agentId);
      navigate(`/chat/${DRAFT_SESSION_ID}`, { state: aiChatRouteState(req) });
    },
    [userId, projectId, setCurrentAgentId, navigate],
  );
  return { openAiChat };
}
