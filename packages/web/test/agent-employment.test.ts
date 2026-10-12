/**
 * Employee Agents in development mode (features/agents/agent-employment.ts).
 *
 * - The Agents page splits its rows into the Agents worked with directly and the
 *   organizations' employees, each part in the order it was given; an Agent employed by
 *   several organizations is one employee, and a list with no employee has no second part.
 * - The pickers list the same Agents with every employee behind the rest.
 * - The sidebar's Agent grouping leaves out an employee with no conversation in the sidebar,
 *   and only that: an employee with one keeps its group, and an Agent that is no employee keeps
 *   its group even when empty.
 */
import { describe, expect, it } from "vitest";
import type { AgentSummary, Employment } from "@prismshadow/penguin-server/api";
import {
  dropsEmployeeGroup,
  employeesLast,
  splitByEmployment,
} from "../src/features/agents/agent-employment";

const job = (orgId: string, title: string): Employment => ({
  orgId,
  orgName: orgId.toUpperCase(),
  title,
  status: "active",
});

const agent = (agentId: string, employments?: Employment[]) =>
  ({ agentId, ...(employments !== undefined ? { employments } : {}) }) as AgentSummary;

const plain = agent("default_agent");
const writer = agent("writer");
const ceo = agent("acme_ceo", [job("acme", "CEO")]);
const analyst = agent("analyst", [job("acme", "Analyst"), job("north", "Auditor")]);
const formerEmployee = agent("former", []);

describe("splitByEmployment", () => {
  it("puts the organizations' employees in a part of their own, each part in the given order", () => {
    const rows = [ceo, plain, analyst, writer].map((a) => ({ agent: a, machineIds: [null] }));
    const { agents, employees } = splitByEmployment(rows, (row) => row.agent);
    expect(agents.map((row) => row.agent.agentId)).toEqual(["default_agent", "writer"]);
    expect(employees.map((row) => row.agent.agentId)).toEqual(["acme_ceo", "analyst"]);
  });

  it("leaves the employees' part empty when nobody is employed, an empty employments list being nobody", () => {
    const { agents, employees } = splitByEmployment([plain, formerEmployee, writer], (a) => a);
    expect(agents).toEqual([plain, formerEmployee, writer]);
    expect(employees).toEqual([]);
  });
});

describe("employeesLast", () => {
  it("moves every employee behind the other Agents without reordering either part", () => {
    expect(employeesLast([analyst, plain, ceo, writer]).map((a) => a.agentId)).toEqual([
      "default_agent",
      "writer",
      "analyst",
      "acme_ceo",
    ]);
  });
});

describe("dropsEmployeeGroup", () => {
  it("drops an employee that has no conversation in the sidebar", () => {
    expect(dropsEmployeeGroup(ceo, 0)).toBe(true);
  });

  it("keeps an employee with a conversation in the sidebar", () => {
    expect(dropsEmployeeGroup(ceo, 1)).toBe(false);
    expect(dropsEmployeeGroup(analyst, 2)).toBe(false);
  });

  it("keeps an Agent that is no employee, even with nothing in it", () => {
    expect(dropsEmployeeGroup(plain, 0)).toBe(false);
    expect(dropsEmployeeGroup(formerEmployee, 0)).toBe(false);
  });
});
