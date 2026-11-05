/**
 * Deleting an organization, and with `deleteAgents` its employees' Agents
 * (`DELETE /api/projects/:p/organizations/:orgId?deleteAgents=1`).
 *
 * The organization goes first, to the Project's trash as it always did, and is gone whatever
 * happens next. Its employees are read before that: every chart entry plus `<orgId>_ceo`, which
 * is what the Agent list marks as its employments. After the trash, each is taken in turn,
 * sequentially so one busy folder does not hold up the rest:
 *
 * - an Agent that no longer exists (a chart entry left behind) is nothing to report;
 * - a built-in Agent is kept (`builtin`): it is provisioned with the Project;
 * - an Agent another organization of the Project still employs is kept (`employed_elsewhere`),
 *   read fresh after the trash;
 * - every other one is deleted exactly as `DELETE …/agents/:agentId` deletes one
 *   (services/agent-deletion.ts). A refusal there — a folder that cannot be moved, a hire that
 *   raced in — is reported as failed with its code and message, and the rest still go.
 *
 * Nothing else names an employee: its desk and ticket rows went with the organization, and its
 * Sessions go with its Agent.
 */
import { BUILTIN_AGENT_IDS } from "@prismshadow/penguin-core";
import type { OrganizationDeleteResponse } from "../api/types.js";
import { HttpError } from "../http/errors.js";
import type { AgentConfig } from "../mechanisms/agents.js";
import type { OrgService } from "../runtime/organization/service.js";
import { deleteAgentEverywhere } from "./agent-deletion.js";
import type { AgentDeletionDeps } from "./agent-deletion.js";

export interface OrganizationDeletionDeps extends Omit<
  AgentDeletionDeps,
  "orgService" | "agentConfigService"
> {
  orgService: Pick<OrgService, "delete" | "employments" | "employersOf">;
  agentConfigService: Pick<AgentConfig, "exists" | "requireExists">;
}

/** The ids of the Agents an organization employs, in the order the employment listing gives them. */
async function employeesOf(
  deps: Pick<OrganizationDeletionDeps, "orgService">,
  projectId: string,
  orgId: string,
): Promise<string[]> {
  const employments = await deps.orgService.employments(projectId);
  return Object.keys(employments).filter((agentId) =>
    employments[agentId]!.some((e) => e.orgId === orgId),
  );
}

export async function deleteOrganizationWithAgents(
  deps: OrganizationDeletionDeps,
  projectId: string,
  orgId: string,
  opts: { deleteAgents: boolean },
): Promise<OrganizationDeleteResponse> {
  const report: OrganizationDeleteResponse = {
    orgId,
    deletedAgents: [],
    keptAgents: [],
    failedAgents: [],
  };
  // Read before the trash: afterwards nothing lists the organization's chart.
  const employees = opts.deleteAgents ? await employeesOf(deps, projectId, orgId) : [];
  // 404 for an organization that is not there, before anything is touched.
  await deps.orgService.delete(projectId, orgId);
  if (employees.length === 0) return report;
  const stillEmployed = await deps.orgService.employments(projectId);
  for (const agentId of employees) {
    if (!(await deps.agentConfigService.exists(projectId, agentId))) continue;
    if (BUILTIN_AGENT_IDS.includes(agentId)) {
      report.keptAgents.push({ agentId, reason: "builtin" });
      continue;
    }
    if (Object.hasOwn(stillEmployed, agentId) && stillEmployed[agentId]!.length > 0) {
      report.keptAgents.push({ agentId, reason: "employed_elsewhere" });
      continue;
    }
    try {
      const deletion = await deleteAgentEverywhere(deps, projectId, agentId);
      report.deletedAgents.push({ agentId, deletion });
    } catch (err) {
      if (err instanceof HttpError) {
        report.failedAgents.push({ agentId, code: err.code, message: err.message });
      } else {
        // The same convergence the app's error handler applies: logged here, never exposed.
        console.error(
          `[server] Deleting Agent ${agentId} with organization ${orgId} failed: ${
            err instanceof Error ? (err.stack ?? err.message) : String(err)
          }`,
        );
        report.failedAgents.push({
          agentId,
          code: "internal",
          message: "Internal server error.",
        });
      }
    }
  }
  return report;
}
