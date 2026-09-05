/**
 * Spend attribution for an organization: every cost figure is derived from usage records
 * joined to the sessions the organization's files claim — desk sessions from the ledger,
 * contributing sessions from the tickets' `Sessions` headers. Nothing is stored; the
 * budget marks in SQLite only remember which alerts already fired.
 */
import type { TicketDoc } from "../../organization/files.js";
import { subordinatesOf } from "../../organization/files.js";
import { zonedMonthRange, zonedPeriodRange } from "../../organization/zoned.js";
import type { ZonedMonthRange } from "../../organization/zoned.js";
import type { OrgDeps } from "./deps.js";
import type { LoadedOrg } from "./model.js";

export interface OrgSpend {
  period: string;
  range: ZonedMonthRange;
  /** Cost per session over the period. */
  bySession: Map<string, number>;
  /** Cost of an employee's own sessions (desk + contributing), each session once. */
  own: Map<string, number>;
  /** Own plus every subordinate's own, recursively. */
  cumulative: Map<string, number>;
  /** A ticket's share of its contributing sessions (a session on n tickets counts 1/n). */
  ticket: Map<string, number>;
  /** A ticket's share plus its descendants' along `Parent`. */
  ticketRolledUp: Map<string, number>;
  /** Some usage ran on an unpriced model. */
  unpriced: boolean;
  /** The organization's session ids the figures were computed over. */
  sessionIds: string[];
}

export interface TicketForSpend {
  ticketId: string;
  doc: TicketDoc;
}

/** Which sessions the organization owns and which employee each belongs to (desk sessions by ledger, ticket sessions by the session row). */
export function orgSessionOwners(
  deps: OrgDeps,
  org: LoadedOrg,
  tickets: readonly TicketForSpend[],
): Map<string, string> {
  const owners = new Map<string, string>();
  for (const [agentId, desk] of Object.entries(org.desks)) {
    owners.set(desk.sessionId, agentId);
    for (const prev of desk.previous) owners.set(prev, agentId);
  }
  for (const t of tickets) {
    for (const sessionId of t.doc.sessions) {
      if (owners.has(sessionId)) continue;
      const row = deps.sessions.findById(sessionId);
      if (row && row.projectId === org.projectId) owners.set(sessionId, row.agentId);
    }
  }
  return owners;
}

export async function computeSpend(
  deps: OrgDeps,
  org: LoadedOrg,
  tickets: readonly TicketForSpend[],
  period?: string,
): Promise<OrgSpend> {
  const now = deps.now?.() ?? Date.now();
  const range =
    (period !== undefined ? zonedPeriodRange(org.config.timezone, period) : null) ??
    zonedMonthRange(org.config.timezone, now);
  const owners = orgSessionOwners(deps, org, tickets);
  const sessionIds = [...owners.keys()];
  const { bySession, unpriced } = await deps.usage.costBySession(
    org.projectId,
    sessionIds,
    new Date(range.fromMs).toISOString(),
    new Date(range.toMs - 1).toISOString(),
  );
  const own = new Map<string, number>();
  for (const e of org.chart.employees) own.set(e.agentId, 0);
  for (const [sessionId, agentId] of owners) {
    const cost = bySession.get(sessionId) ?? 0;
    own.set(agentId, (own.get(agentId) ?? 0) + cost);
  }
  const cumulative = new Map<string, number>();
  for (const e of org.chart.employees) {
    let sum = own.get(e.agentId) ?? 0;
    for (const sub of subordinatesOf(org.chart, e.agentId)) sum += own.get(sub) ?? 0;
    cumulative.set(e.agentId, sum);
  }
  // A session attached to n tickets is split n ways so parents and the organization never double count it.
  const ticketsPerSession = new Map<string, number>();
  for (const t of tickets) {
    for (const s of new Set(t.doc.sessions))
      ticketsPerSession.set(s, (ticketsPerSession.get(s) ?? 0) + 1);
  }
  const ticket = new Map<string, number>();
  for (const t of tickets) {
    let sum = 0;
    for (const s of new Set(t.doc.sessions))
      sum += (bySession.get(s) ?? 0) / (ticketsPerSession.get(s) ?? 1);
    ticket.set(t.ticketId, sum);
  }
  const children = new Map<string, string[]>();
  for (const t of tickets) {
    if (t.doc.parent !== undefined)
      children.set(t.doc.parent, [...(children.get(t.doc.parent) ?? []), t.ticketId]);
  }
  const ticketRolledUp = new Map<string, number>();
  const rollUp = (id: string, depth: number): number => {
    const cached = ticketRolledUp.get(id);
    if (cached !== undefined) return cached;
    let sum = ticket.get(id) ?? 0;
    if (depth < 64) for (const c of children.get(id) ?? []) sum += rollUp(c, depth + 1);
    ticketRolledUp.set(id, sum);
    return sum;
  };
  for (const t of tickets) rollUp(t.ticketId, 0);
  return {
    period: range.period,
    range,
    bySession,
    own,
    cumulative,
    ticket,
    ticketRolledUp,
    unpriced,
    sessionIds,
  };
}

const money = (n: number): string => n.toFixed(2);

/** The `budget:` line of a trigger block: `12.40 / 30.00 USD (41%)`, or the spend alone when unbounded. */
export function budgetLine(org: LoadedOrg, spend: OrgSpend, agentId: string): string {
  const cost = spend.cumulative.get(agentId) ?? 0;
  const budget = org.byId.get(agentId)?.budget;
  if (budget === undefined) return `${money(cost)} USD / unbounded`;
  const ratio = budget > 0 ? Math.round((cost / budget) * 100) : 100;
  return `${money(cost)} / ${money(budget)} USD (${ratio}%)`;
}

/** Employees whose own budget mark, or any ancestor's, is paused for the period. */
export function pausedEmployees(deps: OrgDeps, org: LoadedOrg, period: string): Set<string> {
  const pausedSelf = new Set(
    deps.cache
      .listBudgetStates(org.projectId, org.orgId, period)
      .filter((s) => s.pausedAt !== null)
      .map((s) => s.agentId),
  );
  const out = new Set<string>();
  for (const e of org.chart.employees) {
    if (pausedSelf.has(e.agentId)) {
      out.add(e.agentId);
      for (const sub of subordinatesOf(org.chart, e.agentId)) out.add(sub);
    }
  }
  return out;
}
