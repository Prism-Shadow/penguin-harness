/**
 * Deleting an organization, and with `agentIds` the employees' Agents its confirmation listed
 * (`DELETE /api/projects/:p/organizations/:orgId?deleteAgents=1&agentIds=a,b`).
 *
 * The organization goes first, to the Project's trash as it always did, and is gone whatever
 * happens next. Its employees are read before that: every chart entry plus `<orgId>_ceo`, which
 * is what the Agent list marks as its employments. After the trash the employments are read
 * again, and each employee is classified:
 *
 * - an Agent that no longer exists (a chart entry left behind) is nothing to report;
 * - a built-in Agent is kept (`builtin`): it is provisioned with the Project;
 * - an Agent another organization of the Project still employs is kept (`employed_elsewhere`);
 * - while another organization's chart cannot be read, nobody is provably employed only here,
 *   so every other employee is kept (`employment_unknown`; the report names those organizations
 *   as `unreadableCharts`) — never a delete on a chart nobody could read. The Agent list reports
 *   the same organizations, so the confirmation says so beforehand;
 * - an employee the caller did not list is kept (`not_confirmed`): the confirmation showed what
 *   it would delete, and an Agent hired since, or one that was kept when it was read, is not
 *   deleted on a list nobody saw;
 * - every other one is deleted exactly as `DELETE …/agents/:agentId` deletes one
 *   (services/agent-deletion.ts). Their runs are aborted together and share one wait, and each
 *   then costs a folder rename and the rows keyed on it, the contents being removed in the
 *   background. A refusal there — a folder that cannot be moved, a hire that raced in — is
 *   reported as failed with its code and message, and the rest still go.
 *
 * A listed id that is not an employee of this organization is ignored. Nothing else names an
 * employee: its desk and ticket rows went with the organization, and its Sessions go with its
 * Agent.
 */
import { BUILTIN_AGENT_IDS } from "@prismshadow/penguin-core";
import type { OrganizationDeleteResponse } from "../api/types.js";
import { HttpError } from "../http/errors.js";
import type { AgentConfig } from "../mechanisms/agents.js";
import type { OrgService } from "../runtime/organization/service.js";
import { refuseUndeletable, removeAgents } from "./agent-deletion.js";
import type { AgentDeletionDeps } from "./agent-deletion.js";

export interface OrganizationDeletionDeps extends Omit<
  AgentDeletionDeps,
  "orgService" | "agentConfigService"
> {
  orgService: Pick<OrgService, "delete" | "employmentCensus" | "employersOf">;
  agentConfigService: Pick<AgentConfig, "exists" | "requireExists">;
}

/** What the failure of one Agent's delete reports: an `HttpError`'s own code, else nothing internal. */
function failureOf(
  agentId: string,
  orgId: string,
  err: unknown,
): OrganizationDeleteResponse["failedAgents"][number] {
  if (err instanceof HttpError) return { agentId, code: err.code, message: err.message };
  // The same convergence the app's error handler applies: logged here, never exposed.
  console.error(
    `[server] Deleting Agent ${agentId} with organization ${orgId} failed: ${
      err instanceof Error ? (err.stack ?? err.message) : String(err)
    }`,
  );
  return { agentId, code: "internal", message: "Internal server error." };
}

/**
 * Deletes the organization and, when `agentIds` is given (the Agents the caller confirmed), the
 * employees' Agents among them that still qualify; `agentIds` absent deletes the organization
 * alone and reports nothing.
 */
export async function deleteOrganizationWithAgents(
  deps: OrganizationDeletionDeps,
  projectId: string,
  orgId: string,
  opts: { agentIds?: readonly string[] },
): Promise<OrganizationDeleteResponse> {
  const report: OrganizationDeleteResponse = {
    orgId,
    deletedAgents: [],
    keptAgents: [],
    failedAgents: [],
  };
  const confirmed = opts.agentIds === undefined ? null : new Set(opts.agentIds);
  // Read before the trash: afterwards nothing lists the organization's chart.
  let employees: string[] = [];
  if (confirmed !== null) {
    const { employments } = await deps.orgService.employmentCensus(projectId);
    employees = Object.keys(employments).filter((agentId) =>
      employments[agentId]!.some((e) => e.orgId === orgId),
    );
  }
  // 404 for an organization that is not there, before anything is touched.
  await deps.orgService.delete(projectId, orgId);
  if (confirmed === null || employees.length === 0) return report;

  const after = await deps.orgService.employmentCensus(projectId);
  const candidates: string[] = [];
  for (const agentId of employees) {
    if (!(await deps.agentConfigService.exists(projectId, agentId))) continue;
    if (BUILTIN_AGENT_IDS.includes(agentId)) {
      report.keptAgents.push({ agentId, reason: "builtin" });
    } else if (
      Object.hasOwn(after.employments, agentId) &&
      after.employments[agentId]!.length > 0
    ) {
      report.keptAgents.push({ agentId, reason: "employed_elsewhere" });
    } else if (after.unreadableCharts.length > 0) {
      report.keptAgents.push({ agentId, reason: "employment_unknown" });
      report.unreadableCharts = after.unreadableCharts;
    } else if (!confirmed.has(agentId)) {
      report.keptAgents.push({ agentId, reason: "not_confirmed" });
    } else {
      candidates.push(agentId);
    }
  }

  // The refusals once more, each Agent at its own moment: a hire that raced in lands here.
  const deletable: string[] = [];
  for (const agentId of candidates) {
    try {
      await refuseUndeletable(deps, projectId, agentId);
      deletable.push(agentId);
    } catch (err) {
      report.failedAgents.push(failureOf(agentId, orgId, err));
    }
  }
  for (const removal of await removeAgents(deps, projectId, deletable)) {
    if ("deletion" in removal) {
      report.deletedAgents.push({ agentId: removal.agentId, deletion: removal.deletion });
    } else {
      report.failedAgents.push(failureOf(removal.agentId, orgId, removal.error));
    }
  }
  return report;
}
