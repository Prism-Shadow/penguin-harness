/**
 * Deleting one Agent everywhere this server holds it. `DELETE /api/projects/:p/agents/:agentId`
 * runs it after its owner check, and the organization delete runs it for each employee it takes
 * with it (`DELETE …/organizations/:orgId?deleteAgents=1`), so the two cannot drift apart.
 *
 * In order: the Agent must exist; a built-in Agent is refused; an employee is refused while any
 * organization of the Project employs it (409 `agent_employed`, naming each organization and
 * title) — {@link refuseUndeletable}; then its runs are aborted and drained, what the server
 * holds open in its folder lets go, the folder is moved aside in one rename (its contents are
 * removed in the background, which the returned deletion reports), and every index row keyed on
 * the Agent is dropped — {@link removeAgents}, which takes several Agents at once so their runs
 * share one wait.
 *
 * The employment guard lives here rather than in the Agent service because the organization
 * runtime already depends on that service; this module consumes both.
 */
import type { AgentDeletionInfo, Employment } from "../api/types.js";
import { HttpError } from "../http/errors.js";
import { settleWithin } from "../http/settle.js";
import type { UserDraftsStore } from "../mechanisms/account-data.js";
import type { AgentApi } from "../mechanisms/agent-api.js";
import type { AgentConfig, AgentLifecycle } from "../mechanisms/agents.js";
import type { ErrorLog } from "../mechanisms/observability.js";
import type { Schedules, SessionIndex } from "../mechanisms/sessions.js";
import type { TraceIndex } from "../mechanisms/traces.js";
import type { Workbenches } from "../mechanisms/workbenches.js";
import type { OrgService } from "../runtime/organization/service.js";
import type { SessionManager } from "../runtime/session-manager.js";
import { refuseBuiltinDeletion } from "./agent-service.js";

/** What a deletion reaches: the Agent's folder, its runs, and every table keyed on it. */
export interface AgentDeletionDeps {
  agentConfigService: Pick<AgentConfig, "requireExists">;
  agentService: Pick<AgentLifecycle, "deleteAgent">;
  orgService: Pick<OrgService, "employersOf">;
  manager: Pick<SessionManager, "beginAgentDeletion" | "endAgentDeletion">;
  workbenches: Pick<Workbenches, "releaseAgent">;
  /** Users' unsent drafts, which go with the Agent's Sessions. */
  drafts: Pick<UserDraftsStore, "deleteByAgent">;
  sessionsRepo: Pick<SessionIndex, "deleteByAgent">;
  traceIndex: Pick<TraceIndex, "removeAgent">;
  schedulesRepo: Pick<Schedules, "deleteByAgent">;
  errorsRepo: Pick<ErrorLog, "deleteByAgent">;
  agentApi: Pick<AgentApi, "deleteByAgent">;
}

/** How long aborted runs get to write their Traces before the folder is moved anyway, ms. */
const RUNS_SETTLE_MS = 5000;

/** The refusal of a delete while organizations employ the Agent: each one by name, id and title. */
export function employedError(agentId: string, employers: readonly Employment[]): HttpError {
  const where = employers
    .map((e) => `organization "${e.orgName}" (${e.orgId}) as ${e.title}`)
    .join("; ");
  const leave = employers.length === 1 ? "the organization" : "these organizations";
  return new HttpError(
    409,
    "agent_employed",
    `Agent ${agentId} is an employee of ${where}; make it leave ${leave} before deleting it.`,
  );
}

/**
 * The refusals, before anything is touched: 404 `agent_not_found`, 409
 * `cannot_delete_builtin_agent`, or 409 `agent_employed` while an organization employs it.
 */
export async function refuseUndeletable(
  deps: Pick<AgentDeletionDeps, "agentConfigService" | "orgService">,
  projectId: string,
  agentId: string,
): Promise<void> {
  await deps.agentConfigService.requireExists(projectId, agentId);
  refuseBuiltinDeletion(agentId);
  // An employee is refused before anything is touched: deleting its Agent would leave the
  // organization's chart naming an Agent that is gone, and its desk naming a Session that is.
  // Leaving the organization is the way out, and it keeps the Agent.
  const employers = await deps.orgService.employersOf(projectId, agentId);
  if (employers.length > 0) throw employedError(agentId, employers);
}

/** One Agent's removal: its deletion, or why it was refused (nothing of it removed). */
export type AgentRemoval =
  { agentId: string; deletion: AgentDeletionInfo } | { agentId: string; error: unknown };

/**
 * Removes Agents that passed {@link refuseUndeletable}. All of them are marked as deleting and
 * their runs aborted first, so the runs wind down together within one wait; then each in turn
 * lets go of its folder, has it moved aside and its rows dropped — a few filesystem calls and
 * deletes by key, since the contents are removed in the background. One that cannot be moved
 * (409 `agent_folder_busy`) is reported and the rest still go.
 */
export async function removeAgents(
  deps: Omit<AgentDeletionDeps, "agentConfigService" | "orgService">,
  projectId: string,
  agentIds: readonly string[],
): Promise<AgentRemoval[]> {
  // Mark as deleting and converge active runs (beginAgentDeletion): any new Task during
  // this window gets 409, preventing the race where a new task recreates the directory
  // and revives the Agent between abort and the move. Abort cleanup writes the Trace
  // asynchronously; wait for it to finish before moving the directory, and clear the
  // deleting flag once the move is done (success or failure).
  const deleting = new Set<string>();
  const runnings: Promise<void>[] = [];
  const removals: AgentRemoval[] = [];
  try {
    for (const agentId of agentIds) {
      deleting.add(agentId);
      runnings.push(...deps.manager.beginAgentDeletion(projectId, agentId));
    }
    await settleWithin(runnings, RUNS_SETTLE_MS);
    for (const agentId of agentIds) {
      try {
        removals.push({ agentId, deletion: await removeOne(deps, projectId, agentId) });
      } catch (error) {
        removals.push({ agentId, error });
      } finally {
        deleting.delete(agentId);
        deps.manager.endAgentDeletion(projectId, agentId);
      }
    }
  } finally {
    for (const agentId of deleting) deps.manager.endAgentDeletion(projectId, agentId);
  }
  return removals;
}

/** The folder moved aside and every row keyed on the Agent dropped, once its runs are over. */
async function removeOne(
  deps: Omit<AgentDeletionDeps, "agentConfigService" | "orgService">,
  projectId: string,
  agentId: string,
): Promise<AgentDeletionInfo> {
  // What the server itself holds open in the folder lets go before it is moved.
  await deps.workbenches.releaseAgent(projectId, agentId);
  // One rename takes the folder out of every list and route; its contents are removed in
  // the background, which the answer reports and GET /agent-deletions/:id follows.
  const deletion = await deps.agentService.deleteAgent(projectId, agentId);
  // Found through the Session index, so before its rows go.
  deps.drafts.deleteByAgent(projectId, agentId);
  deps.sessionsRepo.deleteByAgent(projectId, agentId);
  // Trace-index rows describe files that just left: drop them with the Agent.
  deps.traceIndex.removeAgent(projectId, agentId);
  // Per-Agent runtime state keyed on the now-removed sessions/agent: drop it so nothing is
  // orphaned (session ids are never reused, so a leftover row is dead weight). Usage records
  // are deliberately kept — historical stats survive Agent deletion (see deleteAgent).
  deps.schedulesRepo.deleteByAgent(projectId, agentId);
  deps.errorsRepo.deleteByAgent(projectId, agentId);
  // The Agent's API exposure goes with it: a later Agent created under the same id starts
  // off, and no key minted for this one opens it.
  deps.agentApi.deleteByAgent(projectId, agentId);
  return deletion;
}

/**
 * Deletes one Agent: the refusals, then its removal. Throws the refusal as an `HttpError` with
 * nothing deleted; answers the deletion its background removal reports.
 */
export async function deleteAgentEverywhere(
  deps: AgentDeletionDeps,
  projectId: string,
  agentId: string,
): Promise<AgentDeletionInfo> {
  await refuseUndeletable(deps, projectId, agentId);
  const [removal] = await removeAgents(deps, projectId, [agentId]);
  if (removal !== undefined && "deletion" in removal) return removal.deletion;
  throw removal?.error ?? new Error(`Agent ${agentId} was not removed.`);
}
