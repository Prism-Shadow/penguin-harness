import { pickDefaultAgent } from "@prismshadow/penguin-web/internal";

import {
  clearDraft,
  draftKey,
  loadDraft,
  saveDraft,
  type DraftCache,
  type DraftStorage,
} from "./draft-cache";

import { parkActiveDraft } from "./draft-sessions";

/**
 * The Agent a new conversation starts on when nothing names one: the Project's new-chat default
 * while it still names an Agent of this Project, else the built-in `default_agent`, else the
 * first Agent. Null only for an empty list.
 */
export function newChatAgentId(
  agents: readonly AgentSummary[],
  defaults: ChatDefaultsDto,
): string | null {
  const preferred = defaults.agentId;
  if (preferred !== undefined && agents.some((a) => a.agentId === preferred)) return preferred;
  return pickDefaultAgent(agents)?.agentId ?? null;
}

/**
 * Clears the active new-chat slot for an entry point about to navigate to it: typed text is
 * parked as a draft conversation (parkActiveDraft), then the slot is rewritten to the two things
 * a new chat carries over, the model (as after any park or send) and staged skills. Everything
 * else a text-less draft left there is released: its Agent / Workspace / approval-mode
 * selections, so the draft seeds them afresh. The slot is rebuilt from what stays rather than
 * stripped of what goes, so a field the cache gains later starts released too. Returns the
 * parked entry's id, or null when nothing was typed.
 */
export function prepareNewChatDraft(
  userId: string,
  projectId: string,
  storage?: DraftStorage,
): string | null {
  const parked = parkActiveDraft(userId, projectId, storage);
  const key = draftKey(userId, projectId);
  const { modelRef, skills } = loadDraft(key, storage);
  const kept: DraftCache = {};
  if (modelRef) kept.modelRef = modelRef;
  if (skills) kept.skills = skills;
  if (kept.modelRef || kept.skills) saveDraft(key, kept, storage);
  else clearDraft(key, storage);
  return parked;
}
