/**
 * The ticket board's shaping (pure, unit tested): the five columns in lifecycle order, how
 * cards sort inside one, the blocked-only filter, which moves need a reason, and the
 * per-column counts the overview shows.
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

/** The board as rendered: every column, cards sorted, optionally only the blocked ones. */
export function boardColumns(
  res: Pick<OrgTicketsResponse, "columns">,
  opts: { blockedOnly?: boolean } = {},
): BoardColumn[] {
  return TICKET_COLUMNS.map((status) => {
    const all = res.columns[status] ?? [];
    return { status, tickets: sortTickets(opts.blockedOnly ? all.filter(isBlocked) : all) };
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
