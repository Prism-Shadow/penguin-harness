/**
 * A company's finance page, as pure data (features/company/finance-tree.ts).
 *
 * - The spend tree walks the reporting line depth first; an unknown manager starts a tree of
 *   its own. The ticket ledger nests children under parents the same way.
 * - The ledger shows the roots alone until a parent is expanded, one level per expanded
 *   parent, never below a folded ancestor, and a childless row has nothing to fold.
 * - Periods move by whole months across years; other shapes are refused.
 * - A budget reads success under 80%, attention from 80%, danger from 100%, muted without one.
 * - Each day becomes a trend point on its date carrying its cost; the axis breaks after a
 *   skipped calendar day (across months too) and never around an unparsable date.
 * - The KPI row measures the total against the root's budget (leaving budget and ratio out
 *   without one) and counts budgets, warnings and pauses.
 * - Alerts group into paused and warned, a paused alert under paused only, newest first.
 * - The row tooltips name every figure the tables dropped a column for, with stand-ins for a
 *   missing budget or owner.
 * - The state column leads with the live state and adds what the budget did, says paused
 *   once however it is spelled, and stands on the budget alone without a live state.
 */
import { describe, expect, it } from "vitest";
import type { OrgFinanceEmployee, OrgFinanceTicket } from "@prismshadow/penguin-server/api";
import {
  budgetTone,
  markedSpendTone,
  dailyBreaks,
  financeKpis,
  financeSeries,
  groupAlerts,
  shiftPeriod,
  spendRowTooltip,
  spendStateMarks,
  spendTreeRows,
  ticketRowTooltip,
  ticketTreeRows,
  visibleLedgerRows,
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

describe("visibleLedgerRows", () => {
  /** a > b > c, a > d, and the root e with nothing under it. */
  const tree = () =>
    ticketTreeRows([
      ticket("a"),
      ticket("b", "a"),
      ticket("c", "b"),
      ticket("d", "a"),
      ticket("e"),
    ]);

  it("shows the roots alone when nothing is expanded, each counting only its direct children", () => {
    expect(
      visibleLedgerRows(tree(), new Set()).map((r) => [r.ticket.ticketId, r.children]),
    ).toEqual([
      ["a", 2],
      ["e", 0],
    ]);
  });

  it("opens one level per expanded parent", () => {
    expect(visibleLedgerRows(tree(), new Set(["a"])).map((r) => r.ticket.ticketId)).toEqual([
      "a",
      "b",
      "d",
      "e",
    ]);
    expect(
      visibleLedgerRows(tree(), new Set(["a", "b"])).map((r) => [r.ticket.ticketId, r.depth]),
    ).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
      ["d", 1],
      ["e", 0],
    ]);
  });

  it("keeps a subtree hidden while an ancestor above the expanded parent is folded", () => {
    expect(visibleLedgerRows(tree(), new Set(["b"])).map((r) => r.ticket.ticketId)).toEqual([
      "a",
      "e",
    ]);
  });

  it("leaves a childless row with no children to count and nothing to fold", () => {
    const rows = visibleLedgerRows(ticketTreeRows([ticket("only")]), new Set());
    expect(rows).toEqual([{ ticket: ticket("only"), depth: 0, children: 0 }]);
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

  it("reads the organization's own thresholds when given, so a pause below 100% is still danger and a ratio past 100% under a higher pause is not", () => {
    // An organization that pauses at 50%: 60% of budget is already past the pause line —
    // the built-in defaults would paint the meter green while the server has paused it.
    expect(budgetTone(0.6, 0.4, 0.5)).toBe("danger");
    expect(budgetTone(0.45, 0.4, 0.5)).toBe("attention");
    expect(budgetTone(0.2, 0.4, 0.5)).toBe("success");
    // A pause above 100%: over budget is not over the pause line, so not danger.
    expect(budgetTone(1.2, 0.8, 1.5)).toBe("attention");
    expect(budgetTone(1.6, 0.8, 1.5)).toBe("danger");
    // A warn ratio of its own moves the attention line with it.
    expect(budgetTone(0.3, 0.4, 0.5)).toBe("success");
  });
});

describe("markedSpendTone", () => {
  it("lets the server's enforcement marks outrank what the raw ratio reads by the built-in thresholds", () => {
    // Paused at 60% of budget: danger, where the defaults would read success.
    expect(markedSpendTone({ paused: true, warned: true }, 0.6)).toBe("danger");
    // Warned under the built-in 80% line: attention all the same.
    expect(markedSpendTone({ paused: false, warned: true }, 0.6)).toBe("attention");
    // An explicitly false warning means the organization's own warn line has not been
    // reached — success, even over 100% under a pause ratio parked above it.
    expect(markedSpendTone({ paused: false, warned: false }, 1.2)).toBe("success");
    expect(markedSpendTone({ warned: false }, 0.6)).toBe("success");
    // No marks at all: the ratio decides by the built-in thresholds, muted without a budget.
    expect(markedSpendTone({}, 0.5)).toBe("success");
    expect(markedSpendTone({}, 1.2)).toBe("danger");
    expect(markedSpendTone({}, undefined)).toBe("muted");
  });
});

describe("financeSeries", () => {
  it("makes each day a trend point on its date carrying its cost", () => {
    const points = financeSeries([
      { date: "2026-09-01", cost: 2.5 },
      { date: "2026-09-02", cost: 0 },
    ]);
    expect(points.map((p) => [p.bucket, p.cost])).toEqual([
      ["2026-09-01", 2.5],
      ["2026-09-02", 0],
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

describe("spendRowTooltip", () => {
  const labels = {
    own: "Own spend",
    cumulative: "Cumulative",
    budget: "Budget",
    noBudget: "Unbounded",
  };
  const money = (value: number) => `$${value.toFixed(2)}`;

  it("names all three figures, the budget among them", () => {
    expect(spendRowTooltip({ own: 12, cumulative: 41, budget: 100 }, labels, money)).toBe(
      "Own spend $12.00 · Cumulative $41.00 · Budget $100.00",
    );
  });

  it("says a missing budget is unbounded rather than dropping the field", () => {
    expect(spendRowTooltip({ own: 12, cumulative: 41 }, labels, money)).toBe(
      "Own spend $12.00 · Cumulative $41.00 · Budget Unbounded",
    );
  });
});

describe("ticketRowTooltip", () => {
  const labels = {
    owner: "Owner",
    noOwner: "Unassigned",
    cost: "Cost",
    rolledUp: "Rolled-up cost",
  };
  const money = (value: number) => `$${value.toFixed(2)}`;

  it("leads with the id and carries the owner and both costs", () => {
    expect(
      ticketRowTooltip({ ticketId: "TCK-1", cost: 3.2, rolledUp: 8.7 }, "Ada", labels, money),
    ).toBe("TCK-1 · Owner Ada · Cost $3.20 · Rolled-up cost $8.70");
  });

  it("keeps the owner field with a stand-in when nobody owns the ticket", () => {
    expect(
      ticketRowTooltip({ ticketId: "TCK-2", cost: 0, rolledUp: 0 }, undefined, labels, money),
    ).toBe("TCK-2 · Owner Unassigned · Cost $0.00 · Rolled-up cost $0.00");
  });
});

describe("spendStateMarks", () => {
  const calm = { warned: false, paused: false };

  it("leads with the live state and adds what the budget did", () => {
    expect(spendStateMarks(calm, "running")).toEqual([{ tone: "busy", key: "running" }]);
    expect(spendStateMarks(calm, "idle")).toEqual([{ tone: "success", key: "idle" }]);
    expect(spendStateMarks({ warned: true, paused: false }, "running")).toEqual([
      { tone: "busy", key: "running" },
      { tone: "attention", key: "warned" },
    ]);
  });

  it("says paused once, however the two sources spell it", () => {
    // A budget pause is the reason the live state reads `paused`: one mark, not two.
    const paused = [{ tone: "danger", key: "paused" }];
    expect(spendStateMarks({ warned: true, paused: true }, "paused")).toEqual(paused);
    expect(spendStateMarks({ warned: false, paused: true }, "idle")).toEqual([
      { tone: "success", key: "idle" },
      { tone: "danger", key: "paused" },
    ]);
    // The chart knows before the period's figures do, and the row still says why.
    expect(spendStateMarks(calm, "paused")).toEqual(paused);
  });

  it("stands on the budget alone while the live state is unknown", () => {
    // The chart is a best-effort join: a row must still read without it.
    expect(spendStateMarks(calm, undefined)).toEqual([]);
    expect(spendStateMarks({ warned: true, paused: false }, undefined)).toEqual([
      { tone: "attention", key: "warned" },
    ]);
    expect(spendStateMarks({ warned: false, paused: true }, undefined)).toEqual([
      { tone: "danger", key: "paused" },
    ]);
  });
});
