/**
 * The finance page's shaping (pure, unit tested): the spend tree in reporting-line order with
 * depths, the ticket table along parent tickets, period arithmetic for the this / previous
 * switch, the tone a budget ratio takes, the daily series in the trend chart's shape (with
 * the axis breaks where days were skipped), the KPI row's numbers, and the alert list
 * grouped by state.
 */
import type {
  OrgBudgetAlert,
  OrgFinanceEmployee,
  OrgFinanceResponse,
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

/** `yyyy-mm-dd` as a UTC day number; null for anything else. */
function dayNumber(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(ms) ? null : Math.round(ms / 86_400_000);
}

/**
 * Indices after which the daily series skips at least one calendar day: the server lists
 * only the days that recorded a cost, so the chart marks the gaps on its axis rather than
 * drawing the remaining days as neighbours.
 */
export function dailyBreaks(daily: ReadonlyArray<{ date: string }>): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < daily.length; i++) {
    const a = dayNumber(daily[i]!.date);
    const b = dayNumber(daily[i + 1]!.date);
    if (a !== null && b !== null && b - a > 1) out.push(i);
  }
  return out;
}

/** The KPI row: the organization's total against the root's (CEO's) budget, head counts and alert counts. */
export interface FinanceKpis {
  total: number;
  /** The root employee's budget, which covers the whole organization; absent = unbounded. */
  budget?: number;
  ratio?: number;
  employees: number;
  /** Employees with a budget of their own. */
  budgeted: number;
  /** Warned but not (yet) paused. */
  warned: number;
  paused: number;
}

export function financeKpis(data: Pick<OrgFinanceResponse, "employees" | "total">): FinanceKpis {
  const root = data.employees.find((e) => e.reportsTo === null) ?? data.employees[0];
  const budget = root?.budget;
  const ratio = budget !== undefined && budget > 0 ? data.total / budget : undefined;
  return {
    total: data.total,
    ...(budget !== undefined ? { budget } : {}),
    ...(ratio !== undefined ? { ratio } : {}),
    employees: data.employees.length,
    budgeted: data.employees.filter((e) => e.budget !== undefined).length,
    warned: data.employees.filter((e) => e.warned && !e.paused).length,
    paused: data.employees.filter((e) => e.paused).length,
  };
}

/**
 * Alerts grouped by state, newest first inside each group: a pause outranks the warning
 * that preceded it, so an alert carrying both timestamps lists under `paused` only.
 */
export function groupAlerts(alerts: readonly OrgBudgetAlert[]): {
  paused: OrgBudgetAlert[];
  warned: OrgBudgetAlert[];
} {
  const paused = alerts.filter((a) => a.pausedAt !== undefined);
  const warned = alerts.filter((a) => a.pausedAt === undefined && a.warnedAt !== undefined);
  const newestFirst = (key: "pausedAt" | "warnedAt") => (a: OrgBudgetAlert, b: OrgBudgetAlert) =>
    (b[key] ?? "").localeCompare(a[key] ?? "");
  return {
    paused: paused.sort(newestFirst("pausedAt")),
    warned: warned.sort(newestFirst("warnedAt")),
  };
}
