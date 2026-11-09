/**
 * What deleting an organization with its Agents would do to each of its employees, read off an
 * Agent list (pure, so the delete confirmation and its tests share one rule). It is the server's
 * rule for `DELETE …/organizations/:orgId?deleteAgents=1`, seen before the request: a built-in
 * Agent is kept, an Agent another organization also employs is kept, every employee is kept
 * while another organization's chart cannot be read (it may employ them), and every other
 * employee's Agent is deleted for good. The server decides again when the delete runs; this is
 * what the confirmation shows.
 */
import type { AgentSummary, UnreadableChart } from "@prismshadow/penguin-server/api";
import { employmentsOf } from "../../lib/agent-employment";
import { isBuiltinAgent } from "../../lib/builtin-agents";

/**
 * Why an employee's Agent stays: built in, employed by these other organizations (their names),
 * or of unknown employment while another organization's chart cannot be read.
 */
export type KeptReason =
  | { kind: "builtin" }
  | { kind: "employed_elsewhere"; orgNames: string[] }
  | { kind: "employment_unknown" };

export interface OrgDeletePlan {
  /** Deleted with the organization, in the list's order. */
  toDelete: AgentSummary[];
  /** Left as they are, in the list's order. */
  kept: Array<{ agent: AgentSummary; reason: KeptReason }>;
  /** The other organizations whose chart cannot be read: while there is one, nobody is deleted. */
  unreadable: UnreadableChart[];
}

/**
 * Splits the Agents `orgId` employs into those its delete takes along and those it keeps;
 * `unreadableCharts` is what the Agent list reports beside them.
 */
export function orgDeletePlan(
  agents: readonly AgentSummary[],
  orgId: string,
  unreadableCharts: readonly UnreadableChart[] = [],
): OrgDeletePlan {
  // This organization's own chart does not count: it goes to the trash before anyone is judged.
  const unreadable = unreadableCharts.filter((c) => c.orgId !== orgId);
  const plan: OrgDeletePlan = { toDelete: [], kept: [], unreadable };
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
    if (unreadable.length > 0) {
      plan.kept.push({ agent, reason: { kind: "employment_unknown" } });
      continue;
    }
    plan.toDelete.push(agent);
  }
  return plan;
}
