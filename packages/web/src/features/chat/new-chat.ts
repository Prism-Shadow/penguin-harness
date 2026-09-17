/**
 * What every "New chat" entry point starts: the sidebar's pinned button, its header button and
 * group-header "+", the collapsed rail, the chat page's empty state, an Agent card and a plugin's
 * quick start all land on the new-chat draft (/chat/new) through the two rules here.
 *
 * Where a draft field comes from, highest first: what the entry point names in route state (an
 * Agent group's or card's Agent, a Workspace group's path), then the Project's new-chat defaults
 * (`[default_chat]`), then the built-in fallback. A generic "New chat" names nothing, so it
 * starts on the defaults. A selection an abandoned, text-less draft left in the active slot is
 * not a source: prepareNewChatDraft releases it first, or the leftover of one "+" click would
 * stand in for the Project's defaults on every later "New chat".
 */
import type { AgentSummary, ChatDefaultsDto } from "@prismshadow/penguin-server/api";
import { pickDefaultAgent } from "../ai-create/default-agent";
import { clearDraftChatDefaults } from "./draft-cache";
import type { DraftStorage } from "./draft-cache";
import { parkActiveDraft } from "./draft-sessions";

/**
 * The Agent a new conversation starts on when nothing names one: the Project's new-chat default
 * while it still names an Agent of this Project, else the built-in `default_agent`, else the
 * first Agent. Null only for an empty list.
 */
export function newChatAgentId(
  agents: readonly AgentSummary[],
  defaults: ChatDefaultsDto | null,
): string | null {
  const preferred = defaults?.agentId;
  if (preferred !== undefined && agents.some((a) => a.agentId === preferred)) return preferred;
  return pickDefaultAgent(agents)?.agentId ?? null;
}

/**
 * Clears the active new-chat slot for an entry point about to navigate to it: typed text is
 * parked as a draft conversation (parkActiveDraft), then the Agent / Workspace / approval-mode
 * selections still in the slot are released (clearDraftChatDefaults), so the draft seeds them
 * afresh. What stays is the model carry-over, as after any park or send, and staged skills.
 * Returns the parked entry's id, or null when nothing was typed.
 */
export function prepareNewChatDraft(
  userId: string,
  projectId: string,
  storage?: DraftStorage,
): string | null {
  const parked = parkActiveDraft(userId, projectId, storage);
  clearDraftChatDefaults(userId, projectId, storage);
  return parked;
}
