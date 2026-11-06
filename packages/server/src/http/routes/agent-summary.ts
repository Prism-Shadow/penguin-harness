/**
 * An Agent's card as the Agents list answers it: the service's listing item plus what this
 * server knows about it at the moment — active and total Sessions, the 30-day activity, the API
 * switch and the organizations that employ it. Shared by the list and by the archive import,
 * which answers with the card of the Agent it created or replaced.
 */
import type { AgentSummary } from "../../api/types.js";
import type { AgentApi } from "../../mechanisms/agent-api.js";
import type { OrgService } from "../../runtime/organization/service.js";
import type { SessionManager } from "../../runtime/session-manager.js";
import type { AgentListItem } from "../../services/agent-service.js";
import type { SessionService } from "../../services/session-service.js";

/** Window size in days for the card's activity sparkline (last 30 days, including today). */
export const ACTIVITY_DAYS = 30;

export interface AgentSummaryDeps {
  agentApi: Pick<AgentApi, "enabledAgents">;
  manager: Pick<SessionManager, "activeCountForAgent">;
  orgService: Pick<OrgService, "employments">;
  sessionService: Pick<SessionService, "sessionStats">;
}

/** The cards of `items`, in their order: one read of the API switches and one of the organizations for all of them. */
export async function summarizeAgents(
  deps: AgentSummaryDeps,
  projectId: string,
  items: readonly AgentListItem[],
): Promise<AgentSummary[]> {
  const apiEnabled = new Set(deps.agentApi.enabledAgents(projectId));
  const employments = await deps.orgService.employments(projectId);
  return Promise.all(
    items.map(async (item) => {
      const stats = await deps.sessionService.sessionStats(projectId, item.agentId, ACTIVITY_DAYS);
      const employed = Object.hasOwn(employments, item.agentId)
        ? employments[item.agentId]
        : undefined;
      return {
        ...item,
        activeSessionCount: deps.manager.activeCountForAgent(projectId, item.agentId),
        sessionCount: stats.sessionCount,
        sessionActivity: stats.activity,
        apiEnabled: apiEnabled.has(item.agentId),
        ...(employed !== undefined ? { employments: employed } : {}),
      };
    }),
  );
}
