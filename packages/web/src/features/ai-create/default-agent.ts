/**
 * Which agent a "Create with AI" surface hands its prompt to when the caller names none.
 *
 * The built-in `default_agent` wins over the first agent in the list because it is the one
 * that carries the preinstalled plugin library — agent-tuning, agent-development,
 * software-development — and the canned prompts are written against those skills: a prompt
 * asking for a new agent, a Benchmark or an app assumes the tools those plugins install, which
 * any other agent may lack. The first agent is the fallback for a Project whose default agent
 * was deleted; an empty list yields null and the caller disables sending.
 */
import type { AgentSummary } from "@prismshadow/penguin-server/api";

export const DEFAULT_AGENT_ID = "default_agent";

export function pickDefaultAgent(agents: readonly AgentSummary[]): AgentSummary | null {
  return agents.find((a) => a.agentId === DEFAULT_AGENT_ID) ?? agents[0] ?? null;
}
