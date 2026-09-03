/**
 * The channel list's "Sessions" menu, as pure shaping over GET …/sessions (unit tested): a
 * Desks part — one row per employee, titled by the employee's name — and a Tickets part —
 * one group per ticket holding its contributing sessions. A session attached to several
 * tickets appears under each of them; a ticket without a session is not listed (there is
 * nothing to open).
 */
import type {
  OrgDeskItem,
  OrgSessionsResponse,
  OrgTicketSessionItem,
  SessionStatus,
} from "@prismshadow/penguin-server/api";
import type { SessionActivity } from "../../lib/session-activity";

export interface OrgDeskRow {
  sessionId: string;
  agentId: string;
  /** The employee's name — the row title, whatever the session's own title says. */
  title: string;
  status: SessionStatus;
  lastActiveAt: string | null;
}

export interface OrgTicketFolder {
  ticketId: string;
  title: string;
  sessions: OrgTicketSessionItem[];
  /** Any contributing session is live. */
  running: boolean;
}

export interface OrgSessionGroup {
  desks: OrgDeskRow[];
  tickets: OrgTicketFolder[];
  /** Desk rows plus ticket session rows — the group header's count. */
  count: number;
}

/** Desk rows in employee-name order (a stable, human order for a list of people); a running desk is not floated — its hourglass already says so. */
export function deskRows(desks: readonly OrgDeskItem[]): OrgDeskRow[] {
  return [...desks]
    .sort((a, b) => a.name.localeCompare(b.name) || a.agentId.localeCompare(b.agentId))
    .map((d) => ({
      sessionId: d.sessionId,
      agentId: d.agentId,
      title: d.name,
      status: d.status,
      lastActiveAt: d.lastActiveAt ?? null,
    }));
}

/** Ticket folders in the response's order (the board's), keeping only tickets that hold a session. */
export function ticketFolders(tickets: OrgSessionsResponse["tickets"]): OrgTicketFolder[] {
  return tickets
    .filter((t) => t.sessions.length > 0)
    .map((t) => ({
      ticketId: t.ticketId,
      title: t.title,
      sessions: t.sessions,
      running: t.sessions.some((s) => s.status === "running" || s.status === "compacting"),
    }));
}

export function orgSessionGroup(res: OrgSessionsResponse): OrgSessionGroup {
  const desks = deskRows(res.desks);
  const tickets = ticketFolders(res.tickets);
  return {
    desks,
    tickets,
    count: desks.length + tickets.reduce((n, t) => n + t.sessions.length, 0),
  };
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
