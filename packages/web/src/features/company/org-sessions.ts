/**
 * The company sidebar's two session groups, as pure shaping (unit tested) over the
 * organization's chart and its sessions route:
 *
 * - 工位 — one row per EMPLOYEE, in chart order, whether or not a desk session exists yet.
 *   The roster is the chart's (the sessions route only knows employees whose desk has been
 *   opened); the live state is the sessions route's, which is the one that moves.
 * - 工单会话 — every session attached to a ticket, newest first, each carrying the ticket it
 *   contributes to as its subtitle. A session attached to several tickets appears once per
 *   ticket: it is doing two jobs, and hiding one of them would hide where it is being read.
 */
import type {
  OrgChartResponse,
  OrgSessionsResponse,
  SessionStatus,
} from "@prismshadow/penguin-server/api";
import type { SessionActivity } from "../../lib/session-activity";

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
 * chart is the roster; the sessions route supplies each desk's live status, since a run
 * starting does not rewrite the chart. Without a chart yet (the first read of an
 * organization) the sessions route stands in: it walks the same chart server-side, so the
 * order holds and only employees without a desk are missing until the chart lands.
 */
export function deskRows(
  chart: OrgChartResponse | null,
  sessions: OrgSessionsResponse | undefined,
): OrgDeskRow[] {
  const live = new Map((sessions?.desks ?? []).map((d) => [d.agentId, d]));
  if (chart === null) {
    return (sessions?.desks ?? []).map((d) => ({
      agentId: d.agentId,
      name: d.name,
      jobTitle: "",
      sessionId: d.sessionId,
      status: d.status,
    }));
  }
  return chart.employees.map((e) => {
    const desk = live.get(e.agentId);
    return {
      agentId: e.agentId,
      name: e.name,
      jobTitle: e.title,
      sessionId: desk?.sessionId ?? e.desk?.sessionId ?? null,
      // The chart's own state is the fallback: a desk the sessions route has not listed yet
      // (it was opened between the two reads) still shows that it is running.
      status: desk?.status ?? (e.state === "running" ? "running" : "idle"),
    };
  });
}

/**
 * Ticket session rows, newest first by last activity (a session that has never run sorts
 * last, and equal timestamps break by id so the order never flickers).
 */
export function ticketSessionRows(
  sessions: OrgSessionsResponse | undefined,
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
        status: s.status,
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
