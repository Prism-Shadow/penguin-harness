/**
 * finance-tree.ts unit tests: the spend tree along the reporting line, the ticket table
 * along parent tickets, period arithmetic, the budget tone thresholds, the trend series
 * and its axis breaks, the KPI row's numbers and the alert grouping.
 */
import { describe, expect, it } from "vitest";
import type { OrgFinanceEmployee, OrgFinanceTicket } from "@prismshadow/penguin-server/api";
import {
  budgetTone,
  dailyBreaks,
  financeKpis,
  financeSeries,
  groupAlerts,
  shiftPeriod,
  spendTreeRows,
  ticketTreeRows,
} from "../src/features/company/finance-tree";

const employee = (agentId: string, reportsTo: string | null): OrgFinanceEmployee => ({
  agentId,
  name: agentId,
  title: "",
  reportsTo,
  own: 1,
  cumulative: 1,
  warned: false,
  paused: false,
});

const ticket = (ticketId: string, parent?: string): OrgFinanceTicket => ({
  ticketId,
  title: ticketId,
  status: "done",
  ...(parent !== undefined ? { parent } : {}),
  cost: 1,
  rolledUp: 1,
});

describe("spendTreeRows", () => {
  it("walks the reporting line depth-first with depths, an unknown manager starting a tree of its own", () => {
    const rows = spendTreeRows([
      employee("dev", "cto"),
      employee("ceo", null),
      employee("cto", "ceo"),
      employee("lost", "gone"),
    ]);
    expect(rows.map((r) => [r.employee.agentId, r.depth])).toEqual([
      ["ceo", 0],
      ["cto", 1],
      ["dev", 2],
      ["lost", 0],
    ]);
  });
});

describe("ticketTreeRows", () => {
  it("nests children under their parent and starts at the top for an unknown parent", () => {
    const rows = ticketTreeRows([ticket("b", "a"), ticket("a"), ticket("c", "zzz")]);
    expect(rows.map((r) => [r.ticket.ticketId, r.depth])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 0],
    ]);
  });
});

describe("shiftPeriod", () => {
  it("moves whole months across year boundaries and rejects other shapes", () => {
    expect(shiftPeriod("2026-09", -1)).toBe("2026-08");
    expect(shiftPeriod("2026-01", -1)).toBe("2025-12");
    expect(shiftPeriod("2026-12", 1)).toBe("2027-01");
    expect(shiftPeriod("2026-13", 1)).toBeNull();
    expect(shiftPeriod("nope", 1)).toBeNull();
  });
});

describe("budgetTone", () => {
  it("is success under 80%, attention from 80%, danger from 100%, muted without a budget", () => {
    expect(budgetTone(0.5)).toBe("success");
    expect(budgetTone(0.8)).toBe("attention");
    expect(budgetTone(1)).toBe("danger");
    expect(budgetTone(undefined)).toBe("muted");
    expect(budgetTone(Number.NaN)).toBe("muted");
  });
});

describe("financeSeries", () => {
  it("shapes daily costs as the trend chart's points", () => {
    expect(financeSeries([{ date: "2026-09-01", cost: 2.5 }])).toEqual([
      {
        bucket: "2026-09-01",
        cacheRead: 0,
        cacheWrite: 0,
        output: 0,
        total: 0,
        cost: 2.5,
        requests: 0,
        completed: 0,
        denominator: 0,
      },
    ]);
  });
});

describe("dailyBreaks", () => {
  it("marks the point after which a calendar day was skipped, across a month boundary too", () => {
    const daily = [
      { date: "2026-08-30" },
      { date: "2026-08-31" },
      { date: "2026-09-01" },
      { date: "2026-09-03" },
      { date: "2026-09-10" },
    ];
    expect(dailyBreaks(daily)).toEqual([2, 3]);
    expect(dailyBreaks([{ date: "2026-09-02" }])).toEqual([]);
    expect(dailyBreaks([])).toEqual([]);
  });

  it("ignores an unparsable date rather than breaking around it", () => {
    expect(dailyBreaks([{ date: "2026-09-01" }, { date: "nope" }, { date: "2026-09-05" }])).toEqual(
      [],
    );
  });
});

describe("financeKpis", () => {
  const withBudget = (
    agentId: string,
    reportsTo: string | null,
    extra: Partial<OrgFinanceEmployee>,
  ): OrgFinanceEmployee => ({ ...employee(agentId, reportsTo), ...extra });

  it("measures the total against the root's budget and counts budgets, warnings and pauses", () => {
    const kpis = financeKpis({
      total: 21,
      employees: [
        withBudget("cto", "ceo", { budget: 4, warned: true, paused: true }),
        withBudget("ceo", null, { budget: 10, warned: true }),
        withBudget("dev", "cto", {}),
        withBudget("growth", "ceo", { budget: 3, warned: true }),
      ],
    });
    expect(kpis).toEqual({
      total: 21,
      budget: 10,
      ratio: 2.1,
      employees: 4,
      budgeted: 3,
      warned: 2,
      paused: 1,
    });
  });

  it("leaves budget and ratio out when the root has no budget", () => {
    const kpis = financeKpis({ total: 5, employees: [employee("ceo", null)] });
    expect(kpis).toEqual({ total: 5, employees: 1, budgeted: 0, warned: 0, paused: 0 });
    expect("budget" in kpis).toBe(false);
  });
});

describe("groupAlerts", () => {
  it("lists a paused alert under paused only, newest first in each group", () => {
    const groups = groupAlerts([
      { agentId: "a", period: "2026-09", warnedAt: "2026-09-01T00:00:00Z" },
      {
        agentId: "b",
        period: "2026-09",
        warnedAt: "2026-09-01T00:00:00Z",
        pausedAt: "2026-09-02T00:00:00Z",
      },
      { agentId: "c", period: "2026-09", warnedAt: "2026-09-03T00:00:00Z" },
      { agentId: "d", period: "2026-09", pausedAt: "2026-09-04T00:00:00Z" },
      { agentId: "e", period: "2026-09" },
    ]);
    expect(groups.paused.map((a) => a.agentId)).toEqual(["d", "b"]);
    expect(groups.warned.map((a) => a.agentId)).toEqual(["c", "a"]);
  });
});
