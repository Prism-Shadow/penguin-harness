/**
 * Which agent a "Create with AI" surface hands its prompt to when the caller names none.
 *
 * The built-in `default_agent` wins over the first agent in the list because it is the one
 * that carries the preinstalled plugin library — the RSI toolkits (default-rsi-toolkit and the
 * algorithm toolkits), agent-development, rsi-workbench, software-development — and the canned
 * prompts are written against those skills: a prompt asking for a new agent, a Benchmark or an
 * app assumes the tools those plugins install, which any other agent may lack. The first agent
 * is the fallback for a Project whose default agent was deleted; an empty list yields null and
 * the caller disables sending.
 */
import type { AgentSummary } from "@prismshadow/penguin-server/api";
import { isConversationAgent } from "./builtin-agents";

export const DEFAULT_AGENT_ID = "default_agent";

/** Never the system Agent, which takes no prompt. */
export function pickDefaultAgent(agents: readonly AgentSummary[]): AgentSummary | null {
  const chat = agents.filter(isConversationAgent);
  return chat.find((a) => a.agentId === DEFAULT_AGENT_ID) ?? chat[0] ?? null;
}
