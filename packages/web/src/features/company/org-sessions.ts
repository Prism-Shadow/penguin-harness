/**
 * The company sidebar's two session groups, as pure shaping (unit tested) over the
 * organization's chart, its sessions route and the session list's live statuses:
 *
 * - 工位 — one row per EMPLOYEE, in chart order, whether or not a desk session exists yet.
 *   The roster is the chart's (the sessions route only knows employees whose desk has been
 *   opened); the state is the live one where the session list holds the row.
 * - 工单会话 — every session attached to a ticket, newest first, each carrying the ticket it
 *   contributes to as its subtitle. A session attached to several tickets appears once per
 *   ticket: it is doing two jobs, and hiding one of them would hide where it is being read.
 *
 * The employees' own states (the chart's dots, the overview's counts) are corrected the same
 * way by `liveEmployeeStates` at the bottom of this file.
 *
 * Both take their run state from the LIVE statuses first, because the two snapshots behind
 * them only move on an organization event: the sessions route is re-read when a run is
 * dispatched (`org_run`) or a ticket moves, and the chart when a summary does — and a run
 * ENDING publishes none of those. A desk would sit on 「运行中」 until some unrelated event
 * happened to arrive. The session list's own statuses come from the user event channel, which
 * reports every flip of every Session, so they are the state that is actually current; the
 * snapshots stand in for the rows that list has not loaded.
 */
import type {
  OrgChartResponse,
  OrgEmployeeState,
  OrgSessionsResponse,
  SessionStatus,
} from "@prismshadow/penguin-server/api";
import type { SessionActivity } from "../../lib/session-activity";

/**
 * Live run statuses by Session id — the session list store's view of them (state/sessions.tsx),
 * which the user event channel keeps in step. A Session the list has not loaded is simply
 * absent, and the caller falls back to the snapshot it does have.
 */
export type LiveSessionStatuses = ReadonlyMap<string, SessionStatus>;

/** One employee's desk row. `sessionId` is null until a desk has been opened for them. */
export interface OrgDeskRow {
  agentId: string;
  /** The employee's display name — the row title, whatever the session's own title says. */
  name: string;
  /** The employee's job title, shown as the row's tooltip. */
  jobTitle: string;
  sessionId: string | null;
  status: SessionStatus;
}

/** One ticket session's row: the session's own title, under the ticket that names it. */
export interface OrgTicketSessionRow {
  sessionId: string;
  agentId: string;
  /** The session's title, or "" when it has none yet (the caller names it). */
  title: string;
  ticketId: string;
  ticketTitle: string;
  status: SessionStatus;
  lastActiveAt: string | null;
}

/**
 * Desk rows in chart order — the reporting line, which is how the organization reads. The
 * chart is the roster; the run state comes from the live statuses, then from the sessions
 * route's snapshot, then from the chart's own `state` — a desk the sessions route has not
 * listed yet (it was opened between the two reads) still shows that it is running. Without a
 * chart yet (the first read of an organization) the sessions route stands in: it walks the
 * same chart server-side, so the order holds and only employees without a desk are missing
 * until the chart lands.
 */
export function deskRows(
  chart: OrgChartResponse | null,
  sessions: OrgSessionsResponse | undefined,
  live?: LiveSessionStatuses,
): OrgDeskRow[] {
  const snapshot = new Map((sessions?.desks ?? []).map((d) => [d.agentId, d]));
  if (chart === null) {
    return (sessions?.desks ?? []).map((d) => ({
      agentId: d.agentId,
      name: d.name,
      jobTitle: "",
      sessionId: d.sessionId,
      status: live?.get(d.sessionId) ?? d.status,
    }));
  }
  return chart.employees.map((e) => {
    const desk = snapshot.get(e.agentId);
    const sessionId = desk?.sessionId ?? e.desk?.sessionId ?? null;
    const liveStatus = sessionId === null ? undefined : live?.get(sessionId);
    return {
      agentId: e.agentId,
      name: e.name,
      jobTitle: e.title,
      sessionId,
      status: liveStatus ?? desk?.status ?? (e.state === "running" ? "running" : "idle"),
    };
  });
}

/**
 * Ticket session rows, newest first by last activity (a session that has never run sorts
 * last, and equal timestamps break by id so the order never flickers). The run state is the
 * live one where the session list holds the row, for the same reason the desks' is.
 */
export function ticketSessionRows(
  sessions: OrgSessionsResponse | undefined,
  live?: LiveSessionStatuses,
): OrgTicketSessionRow[] {
  const rows: OrgTicketSessionRow[] = [];
  for (const t of sessions?.tickets ?? []) {
    for (const s of t.sessions) {
      rows.push({
        sessionId: s.sessionId,
        agentId: s.agentId,
        title: s.title ?? "",
        ticketId: t.ticketId,
        ticketTitle: t.title,
        status: live?.get(s.sessionId) ?? s.status,
        lastActiveAt: s.lastActiveAt ?? null,
      });
    }
  }
  return rows.sort(
    (a, b) =>
      (b.lastActiveAt ?? "").localeCompare(a.lastActiveAt ?? "") ||
      b.sessionId.localeCompare(a.sessionId),
  );
}

/**
 * The glyph a desk or ticket-session row draws: the same live states the ordinary session
 * list shows (an hourglass while running, the squeeze while compacting), and nothing when
 * settled — these rows have no read marker of their own, so they never claim "unread".
 */
export function orgRowActivity(status: SessionStatus): SessionActivity {
  if (status === "running") return "running";
  if (status === "compacting") return "compacting";
  return null;
}

/**
 * One employee's run state, from the Sessions the organization attributes to it: running while
 * any of them is running or compacting, idle once all of them have settled, and — when nothing
 * is known about any of them — the state the chart itself reported.
 *
 * Each Session is judged by the live status where the list holds it and by the organization's
 * own snapshot otherwise, which is exactly how the desk and ticket rows draw their marks, so
 * the chart and the sidebar can never say different things about the same run.
 *
 * `paused` is not a run state — the budget stopped the employee, and no Session can say
 * otherwise — so it is returned untouched.
 */
function employeeLiveState(
  state: OrgEmployeeState,
  own: ReadonlyArray<{ sessionId: string; status?: SessionStatus }>,
  live: LiveSessionStatuses | undefined,
): OrgEmployeeState {
  if (state === "paused") return "paused";
  let known = false;
  for (const session of own) {
    const status = live?.get(session.sessionId) ?? session.status;
    if (status === undefined) continue;
    known = true;
    if (status === "running" || status === "compacting") return "running";
  }
  return known ? "idle" : state;
}

/**
 * The employees' run states corrected by the live session list, by agent id — what the org
 * chart's dots and the overview's counts draw instead of the chart's own `state`.
 *
 * An employee's Sessions are its desk (named by the chart's entry and by the sessions route,
 * which may know one the other does not yet) and every session attached to a ticket it is
 * working. Both snapshots are re-read only on an organization event, and a run ending
 * publishes none of those, so an employee that finished kept its running dot until something
 * unrelated moved.
 */
export function liveEmployeeStates<
  T extends { agentId: string; state: OrgEmployeeState; desk?: { sessionId: string } },
>(
  employees: readonly T[],
  sessions: OrgSessionsResponse | undefined,
  live?: LiveSessionStatuses,
): ReadonlyMap<string, OrgEmployeeState> {
  const deskOf = new Map((sessions?.desks ?? []).map((d) => [d.agentId, d]));
  const ticketsOf = new Map<string, Array<{ sessionId: string; status: SessionStatus }>>();
  for (const t of sessions?.tickets ?? []) {
    for (const s of t.sessions) {
      const entry = { sessionId: s.sessionId, status: s.status };
      const list = ticketsOf.get(s.agentId);
      if (list) list.push(entry);
      else ticketsOf.set(s.agentId, [entry]);
    }
  }
  const out = new Map<string, OrgEmployeeState>();
  for (const e of employees) {
    const desk = deskOf.get(e.agentId);
    const own: Array<{ sessionId: string; status?: SessionStatus }> = [];
    // The chart's own desk id carries no status: it contributes only what the live list says.
    if (e.desk !== undefined) own.push({ sessionId: e.desk.sessionId });
    if (desk !== undefined) own.push({ sessionId: desk.sessionId, status: desk.status });
    own.push(...(ticketsOf.get(e.agentId) ?? []));
    out.set(e.agentId, employeeLiveState(e.state, own, live));
  }
  return out;
}
