/**
 * What deleting an organization with its Agents would do to each of its employees, read off an
 * Agent list (pure, so the delete confirmation and its tests share one rule). It is the server's
 * rule for `DELETE …/organizations/:orgId?deleteAgents=1`, seen before the request: a built-in
 * Agent is kept, an Agent another organization also employs is kept, and every other employee's
 * Agent is deleted for good. The server decides again when the delete runs; this is what the
 * confirmation shows.
 */
import type { AgentSummary } from "@prismshadow/penguin-server/api";
import { employmentsOf } from "../agents/agent-employment";
import { isBuiltinAgent } from "../agents/builtin-agents";

/** Why an employee's Agent stays: built in, or employed by these other organizations (their names). */
export type KeptReason = { kind: "builtin" } | { kind: "employed_elsewhere"; orgNames: string[] };

export interface OrgDeletePlan {
  /** Deleted with the organization, in the list's order. */
  toDelete: AgentSummary[];
  /** Left as they are, in the list's order. */
  kept: Array<{ agent: AgentSummary; reason: KeptReason }>;
}

/** Splits the Agents `orgId` employs into those its delete takes along and those it keeps. */
export function orgDeletePlan(agents: readonly AgentSummary[], orgId: string): OrgDeletePlan {
  const plan: OrgDeletePlan = { toDelete: [], kept: [] };
  for (const agent of agents) {
    const employments = employmentsOf(agent);
    if (!employments.some((e) => e.orgId === orgId)) continue;
    if (isBuiltinAgent(agent.agentId)) {
      plan.kept.push({ agent, reason: { kind: "builtin" } });
      continue;
    }
    const elsewhere = employments.filter((e) => e.orgId !== orgId);
    if (elsewhere.length > 0) {
      const orgNames = [...new Set(elsewhere.map((e) => e.orgName))];
      plan.kept.push({ agent, reason: { kind: "employed_elsewhere", orgNames } });
      continue;
    }
    plan.toDelete.push(agent);
  }
  return plan;
}
