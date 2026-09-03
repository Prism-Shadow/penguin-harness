/**
 * Which path the Agents page's create dialog opens on. The last explicit choice is kept for the
 * session in module state (a page remount keeps it, a reload does not); before any choice, a
 * Project whose only agent is the built-in default starts on the AI path — nobody has set an
 * agent up there yet — and every other Project starts on the manual form it always had.
 */
import type { AgentSummary } from "@prismshadow/penguin-server/api";
import type { CreateAction } from "../ai-create/create-menu-button";
import { DEFAULT_AGENT_ID } from "../ai-create/default-agent";

let remembered: CreateAction | null = null;

export function rememberCreateMode(mode: CreateAction): void {
  remembered = mode;
}

export function recallCreateMode(): CreateAction | null {
  return remembered;
}

/** Pure: a remembered choice wins; otherwise "ai" while no agent beyond the built-in default exists (an empty list included), else "manual". */
export function resolveCreateMode(
  rememberedMode: CreateAction | null,
  agents: readonly AgentSummary[],
): CreateAction {
  if (rememberedMode !== null) return rememberedMode;
  return agents.every((a) => a.agentId === DEFAULT_AGENT_ID) ? "ai" : "manual";
}
