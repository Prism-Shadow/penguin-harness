/**
 * Agent handoff for the chat input area (pure logic, shared by chat-input.tsx /
 * chat-page.tsx and unit tests). A target agent is picked from the `/agent` command's picker
 * and pinned as a highlighted chip at the front of the input; the text body carries no marker
 * of its own. Nothing is sent at pick time — sending is what performs the handoff, and it
 * opens a NEW conversation for that agent instead of posting to the current Session.
 * - `filterAgents`: the picker's search box — filters candidates by agentId or display name.
 *
 * The origin **marker blocks** these flows produce and render — `[handoff_from]`,
 * `[scheduled_task]`, `[model_switch_from]` — are defined in core's marker module
 * (`@prismshadow/penguin-core/markers`) alongside every other message marker, and are
 * re-exported below under this feature's existing names.
 */
import { buildHandoffMessage, buildModelSwitchMessage } from "@prismshadow/penguin-core/markers";
import type { AgentSummary } from "@prismshadow/penguin-server/api";

export {
  parseHandoffMessage,
  parseModelSwitchMessage,
  parseScheduledMessage,
} from "@prismshadow/penguin-core/markers";
export type {
  HandoffOrigin,
  ModelSwitchOrigin,
  ScheduledOrigin,
} from "@prismshadow/penguin-core/markers";

/** First message of an `/agent` handoff conversation (core's `[handoff_from]` origin block). */
export const handoffMessage = buildHandoffMessage;
/** First message of a `/model` switch new conversation (core's `[model_switch_from]` origin block). */
export const modelSwitchMessage = buildModelSwitchMessage;

/**
 * Filters the `/agent` picker's candidates by its search box: a case-insensitive **substring**
 * match on the agentId or the display name — the same rule the model picker's search box uses,
 * so a word typed from memory ("creator") still finds the agent wherever it sits in the id. An
 * empty query returns every candidate.
 */
export function filterAgents(agents: AgentSummary[], query: string): AgentSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return agents;
  return agents.filter(
    (a) => a.agentId.toLowerCase().includes(q) || (a.name ?? "").toLowerCase().includes(q),
  );
}
