/**
 * The ticket board's shaping (pure, unit tested): the five columns in lifecycle order, how
 * cards sort inside one (by priority, by due date, or by how long they have been waiting),
 * the toolbar's quick filters and their counts, the blocked-only filter and the search box,
 * which moves need a reason, the per-column counts the overview shows, the shape an id slug
 * must take, and the two facts a card reads off a ticket's own fields — whether its due date
 * has passed and the day its id was minted.
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

/**
 * The shape of a ticket id's slug: lowercase letters in hyphen-joined words, no digits — the
 * date prefix already carries the numbers. Mirrors TICKET_SLUG_PATTERN in the server's API
 * contract, which the browser bundle cannot import as a value; the two must stay identical.
 */
export const TICKET_SLUG_PATTERN = /^[a-z]+(?:-[a-z]+)*$/;

/** Whether a typed slug can be used as written; an empty box is not a slug and is left to the server. */
export function isTicketSlug(value: string): boolean {
  return TICKET_SLUG_PATTERN.test(value);
}

const PRIORITY_RANK: Record<string, number> = { P0: 0, P1: 1, P2: 2 };

export function isBlocked(t: Pick<OrgTicketItem, "blocked">): boolean {
  return t.blocked !== undefined && t.blocked !== "";
}

/**
 * How a column orders its cards. `priority` is the board's own order (urgent first, then what is
 * due soonest); `due` reads a column as a calendar (what falls due first, undated last); `age`
 * reads it as a queue (what has been waiting longest, the ones with no readable date last).
 */
export type TicketSort = "priority" | "due" | "age";

/** The day a ticket's id was minted, for the `age` order; "" when the id is in another shape. */
function bornKey(ticketId: string): string {
  return ticketCreatedDate(ticketId) ?? "";
}

const SORTS: Record<
  TicketSort,
  <T extends Pick<OrgTicketItem, "priority" | "due" | "ticketId">>(a: T, b: T) => number
> = {
  priority: (a, b) =>
    (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) ||
    (a.due ?? "￿").localeCompare(b.due ?? "￿") ||
    a.ticketId.localeCompare(b.ticketId),
  due: (a, b) =>
    (a.due ?? "￿").localeCompare(b.due ?? "￿") ||
    (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) ||
    a.ticketId.localeCompare(b.ticketId),
  // Oldest first: an empty key (an id with no readable date) sorts last, never first.
  age: (a, b) =>
    (bornKey(a.ticketId) || "￿").localeCompare(bornKey(b.ticketId) || "￿") ||
    (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) ||
    a.ticketId.localeCompare(b.ticketId),
};

/**
 * A column's cards, ordered by `mode` (priority first — P0 above P2), with ties broken by the
 * mode's own next key and then by id, so equal tickets keep a stable place across refetches.
 */
export function sortTickets<T extends Pick<OrgTicketItem, "priority" | "due" | "ticketId">>(
  tickets: readonly T[],
  mode: TicketSort = "priority",
): T[] {
  return [...tickets].sort(SORTS[mode]);
}

export interface BoardColumn {
  status: OrgTicketStatus;
  tickets: OrgTicketItem[];
}

/** How cards group inside one column: flat, or collapsible sections by owner, priority or parent epic. */
export type TicketGroupBy = "none" | "owner" | "priority" | "parent";

export interface TicketGroup {
  key: string;
  label: string;
  tickets: OrgTicketItem[];
}

/**
 * Cards grouped for one column: groups ordered (owner/parent alphabetically by label,
 * priority by rank P0-first, the ungrouped bucket last), cards inside sorted by sortTickets.
 * `by: "none"` yields the single flat group. Labels resolve through the chart names and the
 * id → title map when given, falling back to the raw id.
 */
export function groupTickets(
  tickets: readonly OrgTicketItem[],
  by: TicketGroupBy,
  opts: {
    names?: ReadonlyMap<string, string>;
    titles?: ReadonlyMap<string, string>;
    /** The board's sort, unchanged by grouping: groups are ordered, cards inside keep the mode. */
    sort?: TicketSort;
  } = {},
): TicketGroup[] {
  const sorted = sortTickets(tickets, opts.sort ?? "priority");
  if (by === "none") return [{ key: "all", label: "", tickets: sorted }];
  const buckets = new Map<string, OrgTicketItem[]>();
  for (const t of sorted) {
    let key: string;
    if (by === "owner") key = t.owner;
    else if (by === "priority") key = t.priority;
    else key = t.parent ?? "";
    const list = buckets.get(key);
    if (list !== undefined) list.push(t);
    else buckets.set(key, [t]);
  }
  const labelOf = (key: string): string => {
    if (by === "owner") {
      const id = key.startsWith("agent:") ? key.slice(6) : key;
      return opts.names?.get(id) ?? key;
    }
    if (by === "parent") return key === "" ? "" : (opts.titles?.get(key) ?? key);
    return key;
  };
  const rankOf = (key: string): number => {
    if (by === "priority") return PRIORITY_RANK[key] ?? 9;
    return 0;
  };
  return [...buckets.entries()]
    .sort(([ak], [bk]) => {
      if (by === "parent") {
        if (ak === "") return 1;
        if (bk === "") return -1;
      }
      return rankOf(ak) - rankOf(bk) || labelOf(ak).localeCompare(labelOf(bk));
    })
    .map(([key, list]) => ({ key, label: labelOf(key), tickets: list }));
}

/**
 * Whole days since the ticket was minted, read off its id (`yyyy-mm-dd-<slug>`) against the
 * local day `todayKey` (same form); null when either side is not a plain date. Powers the
 * waiting-age badge on cards still asking someone for something.
 */
export function ticketAgeDays(ticketId: string, todayKey: string): number | null {
  const born = ticketCreatedDate(ticketId);
  if (born === null || !/^\d{4}-\d{2}-\d{2}$/.test(todayKey)) return null;
  const ms = Date.parse(`${todayKey}T00:00:00Z`) - Date.parse(`${born}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.round(ms / 86400000));
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
  const ownerId = t.owner.startsWith("agent:") ? t.owner.slice(6) : null;
  const ownerName = ownerId !== null ? names?.get(ownerId) : undefined;
  return [t.title, t.ticketId, t.owner, t.parent, ownerName].some(
    (v) => v !== undefined && v.toLowerCase().includes(q),
  );
}

/**
 * The board's one-at-a-time quick filters, in the order the toolbar shows them: everything, what
 * is waiting on a person (proposed and review — the approval queue), what is blocked, what is
 * past its due date, and the reader's own tickets. The search box and the priority chips layer
 * on top of whichever one is on.
 */
export type BoardQuickFilter = "all" | "queue" | "blocked" | "overdue" | "mine";

export const BOARD_QUICK_FILTERS: readonly BoardQuickFilter[] = [
  "all",
  "queue",
  "blocked",
  "overdue",
  "mine",
];

/** Whether one ticket survives a quick filter. `me` is the reader's own principal ("user:<id>"). */
export function matchesQuickFilter(
  t: Pick<OrgTicketItem, "status" | "owner" | "due" | "blocked">,
  quick: BoardQuickFilter,
  opts: { todayKey?: string; me?: string } = {},
): boolean {
  switch (quick) {
    case "all":
      return true;
    case "queue":
      return t.status === "proposed" || t.status === "review";
    case "blocked":
      return isBlocked(t);
    // The card's own rule: a date in the past on a ticket still open. A finished or rejected
    // ticket is never "overdue", however old its date.
    case "overdue":
      return (
        isOverdue(t.due, opts.todayKey ?? "") && t.status !== "done" && t.status !== "rejected"
      );
    case "mine":
      return opts.me !== undefined && opts.me !== "" && t.owner === opts.me;
  }
}

/** The five quick-filter counts, over the tickets the search box and the chips left on the board. */
export interface BoardCounts {
  total: number;
  queue: number;
  blocked: number;
  overdue: number;
  mine: number;
}

export function boardCounts(
  tickets: readonly OrgTicketItem[],
  opts: { todayKey?: string; me?: string } = {},
): BoardCounts {
  const counts: BoardCounts = { total: tickets.length, queue: 0, blocked: 0, overdue: 0, mine: 0 };
  for (const t of tickets) {
    if (matchesQuickFilter(t, "queue", opts)) counts.queue += 1;
    if (isBlocked(t)) counts.blocked += 1;
    if (matchesQuickFilter(t, "overdue", opts)) counts.overdue += 1;
    if (matchesQuickFilter(t, "mine", opts)) counts.mine += 1;
  }
  return counts;
}

/**
 * The board as rendered: every column, cards in `sort` order, narrowed by the quick filter, the
 * blocked-only switch, the priority chips and the search box — all of them at once.
 */
export function boardColumns(
  res: Pick<OrgTicketsResponse, "columns">,
  opts: {
    blockedOnly?: boolean;
    query?: string;
    names?: ReadonlyMap<string, string>;
    /** Priorities to keep; undefined or empty keeps everything. */
    priorities?: readonly string[];
    /** The toolbar's quick filter; undefined reads as `all`. */
    quick?: BoardQuickFilter;
    /** The local day `overdue` reads against, in `yyyy-mm-dd`. */
    todayKey?: string;
    /** The reader's own principal, for `mine`. */
    me?: string;
    sort?: TicketSort;
  } = {},
): BoardColumn[] {
  return TICKET_COLUMNS.map((status) => {
    const all = res.columns[status] ?? [];
    const kept = all.filter(
      (t) =>
        (!opts.blockedOnly || isBlocked(t)) &&
        (opts.priorities === undefined ||
          opts.priorities.length === 0 ||
          opts.priorities.includes(t.priority)) &&
        matchesQuickFilter(t, opts.quick ?? "all", opts) &&
        matchesTicketQuery(t, opts.query ?? "", opts.names),
    );
    return { status, tickets: sortTickets(kept, opts.sort ?? "priority") };
  });
}

/** Moving into `rejected` records a reason under Result; every other move is a bare status change. */
export function moveNeedsReason(target: OrgTicketStatus): boolean {
  return target === "rejected";
}

/** A drop is a move only across columns; dropping a card back on its own column changes nothing. */
export function canMove(from: OrgTicketStatus, to: OrgTicketStatus): boolean {
  return from !== to;
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
