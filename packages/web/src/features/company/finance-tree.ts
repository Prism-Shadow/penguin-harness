/**
 * The finance page's shaping (pure, unit tested): the spend tree in reporting-line order with
 * depths, the ticket table along parent tickets, period arithmetic for the this / previous
 * switch, the tone a budget ratio takes, and the daily series in the trend chart's shape.
 */
import type {
  OrgFinanceEmployee,
  OrgFinanceTicket,
  UsageSeriesPoint,
} from "@prismshadow/penguin-server/api";
import type { Tone } from "../../lib/tone";

/** Employees in DFS order from the root(s), each with its depth; a row whose manager is missing starts a tree of its own. */
export function spendTreeRows(
  employees: readonly OrgFinanceEmployee[],
): Array<{ employee: OrgFinanceEmployee; depth: number }> {
  const ids = new Set(employees.map((e) => e.agentId));
  const childrenOf = new Map<string | null, OrgFinanceEmployee[]>();
  for (const e of employees) {
    const parent = e.reportsTo !== null && ids.has(e.reportsTo) ? e.reportsTo : null;
    const list = childrenOf.get(parent);
    if (list) list.push(e);
    else childrenOf.set(parent, [e]);
  }
  const out: Array<{ employee: OrgFinanceEmployee; depth: number }> = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number): void => {
    for (const e of childrenOf.get(parent) ?? []) {
      if (seen.has(e.agentId)) continue;
      seen.add(e.agentId);
      out.push({ employee: e, depth });
      walk(e.agentId, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Tickets in parent-first order with depths (a child under its parent, an unknown parent starting at the top). */
export function ticketTreeRows(
  tickets: readonly OrgFinanceTicket[],
): Array<{ ticket: OrgFinanceTicket; depth: number }> {
  const ids = new Set(tickets.map((t) => t.ticketId));
  const childrenOf = new Map<string | null, OrgFinanceTicket[]>();
  for (const t of tickets) {
    const parent = t.parent !== undefined && ids.has(t.parent) ? t.parent : null;
    const list = childrenOf.get(parent);
    if (list) list.push(t);
    else childrenOf.set(parent, [t]);
  }
  const out: Array<{ ticket: OrgFinanceTicket; depth: number }> = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number): void => {
    for (const t of childrenOf.get(parent) ?? []) {
      if (seen.has(t.ticketId)) continue;
      seen.add(t.ticketId);
      out.push({ ticket: t, depth });
      walk(t.ticketId, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** `yyyy-mm` shifted by whole months (a negative delta goes back). Null for anything not of that shape. */
export function shiftPeriod(period: string, delta: number): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return null;
  const year = Number(m[1]);
  const month0 = Number(m[2]) - 1;
  if (month0 < 0 || month0 > 11) return null;
  const total = year * 12 + month0 + delta;
  const y = Math.floor(total / 12);
  const mo = total - y * 12;
  return `${String(y).padStart(4, "0")}-${String(mo + 1).padStart(2, "0")}`;
}

/** The tone a spend-against-budget ratio takes: attention from 80%, danger from 100%, success below; muted without a budget. */
export function budgetTone(ratio: number | undefined): Tone {
  if (ratio === undefined || !Number.isFinite(ratio)) return "muted";
  if (ratio >= 1) return "danger";
  if (ratio >= 0.8) return "attention";
  return "success";
}

/** The finance page's daily costs in the cost trend chart's series shape (tokens unknown here, so zero). */
export function financeSeries(
  daily: ReadonlyArray<{ date: string; cost: number }>,
): UsageSeriesPoint[] {
  return daily.map((d) => ({
    bucket: d.date,
    cacheRead: 0,
    cacheWrite: 0,
    output: 0,
    total: 0,
    cost: d.cost,
    requests: 0,
    completed: 0,
    denominator: 0,
  }));
}
