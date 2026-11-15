/**
 * Agent listing helpers the resource commands and the session commands share: the agents
 * summary (one entry per agent of the project) and the per-agent session listing.
 * DTO shapes come from this package's api types.
 */
import type { AgentSummary, AgentsResponse, SessionInfo, SessionsResponse } from "../api/types.js";
import type { ServerClient } from "./client.js";

const enc = encodeURIComponent;

export async function listAgents(client: ServerClient, projectId: string): Promise<AgentSummary[]> {
  const res = await client.request<AgentsResponse>("GET", `/api/projects/${enc(projectId)}/agents`);
  return res.agents;
}

export async function listAgentSessions(
  client: ServerClient,
  projectId: string,
  agentId: string,
): Promise<SessionInfo[]> {
  const res = await client.request<SessionsResponse>(
    "GET",
    `/api/projects/${enc(projectId)}/agents/${enc(agentId)}/sessions`,
    undefined,
  );
  return res.sessions;
}
