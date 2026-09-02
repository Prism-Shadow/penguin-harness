/**
 * The ticket board's shaping (pure, unit tested): the five columns in lifecycle order, how
 * cards sort inside one, the blocked-only filter and the search box, which moves need a
 * reason, the per-column counts the overview shows, and the two facts a card reads off a
 * ticket's own fields — whether its due date has passed and the day its id was minted.
 */
import type {
  OrgTicketItem,
  OrgTicketStatus,
  OrgTicketsResponse,
} from "@prismshadow/penguin-server/api";

/** The five kanban columns, in lifecycle order. */
export const TICKET_COLUMNS: readonly OrgTicketStatus[] = [
  "proposed",
  "in_progress",
  "review",
  "done",
  "rejected",
];

export function isTicketStatus(value: string | null | undefined): value is OrgTicketStatus {
  return (TICKET_COLUMNS as readonly string[]).includes(value ?? "");
}

const PRIORITY_RANK: Record<string, number> = { P0: 0, P1: 1, P2: 2 };

export function isBlocked(t: Pick<OrgTicketItem, "blocked">): boolean {
  return t.blocked !== undefined && t.blocked !== "";
}

/**
 * A column's cards: priority first (P0 above P2), earlier due date next, then the id — so the
 * urgent and the overdue rise, and equal tickets keep a stable place across refetches.
 */
export function sortTickets<T extends Pick<OrgTicketItem, "priority" | "due" | "ticketId">>(
  tickets: readonly T[],
): T[] {
  return [...tickets].sort(
    (a, b) =>
      (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) ||
      (a.due ?? "￿").localeCompare(b.due ?? "￿") ||
      a.ticketId.localeCompare(b.ticketId),
  );
}

export interface BoardColumn {
  status: OrgTicketStatus;
  tickets: OrgTicketItem[];
}

/**
 * The search box's match: case-insensitive, against the title, the id, the owner principal
 * and the parent id, and — when the caller passes the chart's names — the owner's display
 * name, so "dev" finds Dev's tickets whether the user thinks in ids or names.
 */
export function matchesTicketQuery(
  t: Pick<OrgTicketItem, "title" | "ticketId" | "owner" | "parent">,
  query: string,
  names?: ReadonlyMap<string, string>,
): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const ownerId = t.owner !== undefined && t.owner.startsWith("agent:") ? t.owner.slice(6) : null;
  const ownerName = ownerId !== null ? names?.get(ownerId) : undefined;
  return [t.title, t.ticketId, t.owner, t.parent, ownerName].some(
    (v) => v !== undefined && v.toLowerCase().includes(q),
  );
}

/** The board as rendered: every column, cards sorted, narrowed by the blocked-only switch and the search box. */
export function boardColumns(
  res: Pick<OrgTicketsResponse, "columns">,
  opts: { blockedOnly?: boolean; query?: string; names?: ReadonlyMap<string, string> } = {},
): BoardColumn[] {
  return TICKET_COLUMNS.map((status) => {
    const all = res.columns[status] ?? [];
    const kept = all.filter(
      (t) =>
        (!opts.blockedOnly || isBlocked(t)) && matchesTicketQuery(t, opts.query ?? "", opts.names),
    );
    return { status, tickets: sortTickets(kept) };
  });
}

/** Per-column counts plus how many tickets are blocked anywhere (the overview's board block). */
export function boardCounts(res: Pick<OrgTicketsResponse, "columns">): {
  byStatus: Record<OrgTicketStatus, number>;
  blocked: number;
} {
  const byStatus = { proposed: 0, in_progress: 0, review: 0, done: 0, rejected: 0 };
  let blocked = 0;
  for (const status of TICKET_COLUMNS) {
    const list = res.columns[status] ?? [];
    byStatus[status] = list.length;
    blocked += list.filter(isBlocked).length;
  }
  return { byStatus, blocked };
}

/** Moving into `rejected` records a reason under Result; every other move is a bare status change. */
export function moveNeedsReason(target: OrgTicketStatus): boolean {
  return target === "rejected";
}

/** A drop is a move only across columns; dropping a card back on its own column changes nothing. */
export function canMove(from: OrgTicketStatus, to: OrgTicketStatus): boolean {
  return from !== to;
}

/** Tickets whose blocker is the given user (`user:<id>`) — what the overview's "blocked on me" lists. */
export function blockedOnUser<T extends Pick<OrgTicketItem, "blocked" | "blockedBy">>(
  tickets: readonly T[],
  userId: string,
): T[] {
  return tickets.filter((t) => isBlocked(t) && t.blockedBy === `user:${userId}`);
}

/** Every ticket of the board in column order — the parent picker's list and the id → title map. */
export function allTickets(res: Pick<OrgTicketsResponse, "columns">): OrgTicketItem[] {
  return TICKET_COLUMNS.flatMap((status) => res.columns[status] ?? []);
}

/** A due date (`yyyy-mm-dd`) is overdue once the local day `todayKey` (same form) has passed it. */
export function isOverdue(due: string | undefined, todayKey: string): boolean {
  return due !== undefined && /^\d{4}-\d{2}-\d{2}/.test(due) && due.slice(0, 10) < todayKey;
}

/** The day a ticket was minted, read off its id (`yyyy-mm-dd-<slug>`); null for an id in another shape. */
export function ticketCreatedDate(ticketId: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})-/.exec(ticketId);
  return m === null ? null : m[1]!;
}

/** Tickets the server flagged (status disagreeing with the column, a duplicate id), in column order. */
export function invalidTickets(res: Pick<OrgTicketsResponse, "columns">): OrgTicketItem[] {
  return allTickets(res).filter((t) => t.invalid !== undefined);
}
