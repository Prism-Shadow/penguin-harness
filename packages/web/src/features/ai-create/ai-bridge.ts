/**
 * The bridge from a "Create with AI" surface into a new conversation. The prompt is written into
 * the active new-chat draft (the cache draft-view reads on mount), the requested agent becomes
 * the current one, and the route jumps to the draft page with the request in location.state.
 * Nothing is ever submitted here: the prompt lands in the composer and sending stays the user's
 * action, so what reaches the model is always something a person read and pressed Send on.
 *
 * Typed-but-unsent text in the active draft is parked first (draft-sessions.ts) rather than
 * overwritten by the canned prompt, and the model selection carries over, as it does across
 * sends. The composed prompt itself is written as `aiPrefill` (draft-cache.ts) so that it dies
 * with the draft it seeds: nobody typed it, so it is never parked in turn, and leaving the draft
 * page without editing or sending it clears the slot.
 */
import { useCallback } from "react";
import { useNavigate } from "react-router";
import type { ModelRefDto } from "@prismshadow/penguin-server/api";
import { useAuth } from "../../state/auth";
import { useProject } from "../../state/project";
import {
  DRAFT_SESSION_ID,
  draftKey,
  loadDraft,
  parkActiveDraft,
  saveDraft,
  type DraftCache,
} from "../chat";

export interface AiChatRequest {
  /** The agent that does the work (normally pickDefaultAgent's choice). */
  agentId: string;
  /** The whole prompt, instruction tail included (composeAiPrompt). */
  text: string;
  /** Pins the draft's Workspace ("" is the temporary Workspace); absent, the draft keeps its cached choice. */
  workspace?: string;
  /** Skills to preselect in the composer; absent or empty clears a stale selection. */
  skills?: string[];
  /** Pins the new conversation's model (a paired reference); absent, the draft keeps its cached carry-over. */
  modelRef?: ModelRefDto;
  /**
   * The machine `agentId` lives on (lib/agent-location.ts): the conversation opens on that
   * machine — in `workspace` there, or its temporary Workspace — since its Agent can only run
   * there. Absent or null for an agent of this server.
   */
  machineId?: string | null;
}

/** What the draft page finds in `location.state` after openAiChat. */
export interface AiChatRouteState {
  agentId: string;
  workspace?: string;
  /** Travels with `workspace`, never alone: the draft applies a machine only with its path. */
  machineId?: string;
}

/**
 * The draft cache entry for a request, merged over what the active slot holds so the model
 * carry-over survives unless the request pins a model of its own. A leftover `/agent` handoff
 * chip is dropped: it would forward the prompt to a different agent than the one named here. The
 * text is marked as composed rather than typed (`aiPrefill`, see draft-cache.ts), which is what
 * keeps it from outliving the draft it seeds.
 */
export function buildAiDraft(existing: DraftCache, req: AiChatRequest): DraftCache {
  const draft: DraftCache = {
    ...existing,
    agentId: req.agentId,
    text: req.text,
    skills: req.skills ?? [],
    aiPrefill: true,
  };
  if (req.machineId !== undefined && req.machineId !== null) {
    // A machine's agent runs there: the Workspace is one on that machine, recorded with it.
    draft.workspace = req.workspace ?? "";
    draft.machineId = req.machineId;
  } else if (req.workspace !== undefined) {
    // A path pinned here is a path on this server: a machine left from the cached draft would
    // create the Session over there.
    draft.workspace = req.workspace;
    delete draft.machineId;
  }
  if (req.modelRef !== undefined) draft.modelRef = req.modelRef;
  delete draft.handoffAgentId;
  return draft;
}

/** The route state carried to the draft page: only what was asked for, so a request that pins no Workspace leaves no `workspace` key behind. */
export function aiChatRouteState(req: AiChatRequest): AiChatRouteState {
  if (req.machineId !== undefined && req.machineId !== null) {
    return { agentId: req.agentId, workspace: req.workspace ?? "", machineId: req.machineId };
  }
  return {
    agentId: req.agentId,
    ...(req.workspace !== undefined ? { workspace: req.workspace } : {}),
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
      // The current Agent is one of this server's: a machine's agent is named by the route alone.
      if (req.machineId === undefined || req.machineId === null) setCurrentAgentId(req.agentId);
      navigate(`/chat/${DRAFT_SESSION_ID}`, { state: aiChatRouteState(req) });
    },
    [userId, projectId, setCurrentAgentId, navigate],
  );
  return { openAiChat };
}
