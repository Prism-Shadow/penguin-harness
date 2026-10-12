/**
 * Employee Agents in development mode (pure, unit tested).
 *
 * An employee of an organization is an ordinary Agent: development mode can still chat with it
 * and change its settings, which is the only place its prompt, tools and skills are edited. It
 * is kept apart from the Agents the user works with directly rather than hidden — the Agents
 * page lists employees in a section of their own, the pickers list them last, and the
 * sidebar's Agent grouping drops an employee that has no development conversation (its work
 * happens in company mode, so an empty group of its own is clutter). The fact every surface
 * reads is `AgentSummary.employments`: absent or empty means the Agent is not an employee.
 */
import type { AgentSummary, Employment } from "@prismshadow/penguin-server/api";

type Employable = Pick<AgentSummary, "employments">;

/** The organizations employing an Agent, in the server's order; empty when none does. */
export function employmentsOf(agent: Employable): readonly Employment[] {
  return agent.employments ?? [];
}

/** Whether any organization of the Project employs the Agent. */
export function isEmployee(agent: Employable): boolean {
  return employmentsOf(agent).length > 0;
}

/**
 * The Agents page's two sections, each keeping the order it was given: the Agents the user
 * works with directly, then the organizations' employees. `agentOf` reads the Agent off a
 * list item, so the page can split its merged rows (an Agent and the machines it is on).
 */
export function splitByEmployment<T>(
  items: readonly T[],
  agentOf: (item: T) => Employable,
): { agents: T[]; employees: T[] } {
  const agents: T[] = [];
  const employees: T[] = [];
  for (const item of items) (isEmployee(agentOf(item)) ? employees : agents).push(item);
  return { agents, employees };
}

/** A picker's order: the same Agents with every employee moved behind the rest, each part in its own order. */
export function employeesLast<T extends Employable>(agents: readonly T[]): T[] {
  const { agents: plain, employees } = splitByEmployment(agents, (a) => a);
  return [...plain, ...employees];
}

/**
 * Whether the sidebar's Agent grouping leaves this Agent out: an employee with no development
 * conversation at all — none active and none in its folders. Its desk and ticket sessions are
 * company mode's and are never counted here. An employee that has development conversations
 * keeps its group, and an Agent that is no employee always does (an empty group is how a new
 * Agent is reached from the sidebar).
 */
export function dropsEmployeeGroup(
  agent: Employable,
  shares: { active: number; folded: number },
): boolean {
  return isEmployee(agent) && shares.active === 0 && shares.folded === 0;
}
