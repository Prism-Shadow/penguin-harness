/**
 * finance-tree.ts unit tests: the spend tree along the reporting line, the ticket table
 * along parent tickets, period arithmetic, the budget tone thresholds and the trend series.
 */
import { describe, expect, it } from "vitest";
import type { OrgFinanceEmployee, OrgFinanceTicket } from "@prismshadow/penguin-server/api";
import {
  budgetTone,
  financeSeries,
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
