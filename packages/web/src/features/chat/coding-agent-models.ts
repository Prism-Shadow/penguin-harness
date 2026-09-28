/**
 * External coding agents (Claude Code, Codex, OpenCode, Copilot, Cline, ...) as model rows.
 * The server lists them with the model list (`ModelsResponse.codingAgentModels`), each under
 * the `coding-agent` provider: one row per agent, plus one per model it advertised, with the
 * pick encoded in the row's `modelId`. Picking one and sending starts an ordinary Session.
 */
import type { ModelRefDto } from "@prismshadow/penguin-server/api";

export const CODING_AGENT_PROVIDER = "coding-agent";

/** Separates agent id, config option id and value inside a row's `modelId`. */
const SEP = "::";

/** The coding agent a dropdown pick names, with its model choice; null for an ordinary model. */
export function parseCodingAgentRef(
  ref: ModelRefDto | null,
): { agentId: string; model: { configId: string; value: string } | null } | null {
  if (ref?.provider !== CODING_AGENT_PROVIDER) return null;
  const [agentId = "", configId, ...value] = ref.modelId.split(SEP);
  if (configId === undefined || value.length === 0) return { agentId, model: null };
  return { agentId, model: { configId, value: value.join(SEP) } };
}

export function isCodingAgentRow(row: { provider: string }): boolean {
  return row.provider === CODING_AGENT_PROVIDER;
}

/** Agents made by a model vendor Penguin has a logo for; every other agent gets a letter tile. */
const VENDOR_LOGOS: Record<string, string> = {
  claude: "anthropic",
  codex: "openai",
  gemini: "google",
  kimi: "moonshot",
};

/**
 * What to hand ProviderLogo for an agent: its vendor's logo where Penguin has one, otherwise
 * its own name, which ProviderLogo draws as a letter tile coloured by that name.
 */
export function codingAgentLogo(agentId: string, title: string): string {
  return VENDOR_LOGOS[agentId] ?? title;
}
