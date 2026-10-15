/**
 * The ticket board's shaping (pure, unit tested): the five columns in lifecycle order, how
 * cards sort inside one, the blocked-only filter and the search box, which moves need a
 * reason, the per-column counts the overview shows, the shape an id slug must take, and the
 * two facts a card reads off a ticket's own fields — whether its due date has passed and the
 * day its id was minted.
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

/** How cards group inside one column: flat, or collapsible sections by owner, priority, parent epic, work module or tender project. */
export type TicketGroupBy = "none" | "owner" | "priority" | "parent" | "module" | "project";

/**
 * The work module read off a bid-ops title (`响应文件：…` / `Demo：…` / `分析：…`);
 * "" when the title follows no convention (R&D tickets, tests).
 */
export function ticketModule(title: string): string {
  if (title.startsWith("响应文件：")) return "resp";
  if (title.startsWith("Demo：")) return "demo";
  if (title.startsWith("分析：")) return "req";
  return "";
}

/**
 * The tender project read off a bid-ops title: the project name between the module
 * prefix and the kind suffix (`演示系统（包A）` / ` 需求分析`); "" when unparseable.
 * Package suffixes fold away so one project's packages group together.
 */
export function ticketProject(title: string): string {
  let rest: string | null = null;
  if (title.startsWith("响应文件：")) rest = title.slice("响应文件：".length);
  else if (title.startsWith("Demo："))
    rest = title.slice("Demo：".length).replace(/\s*演示系统(\s*（[^）]*）)?\s*$/, "");
  else if (title.startsWith("分析："))
    rest = title.slice("分析：".length).replace(/\s*需求分析\s*$/, "");
  if (rest === null) return "";
  return rest.trim();
}

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
    moduleNames?: ReadonlyMap<string, string>;
  } = {},
): TicketGroup[] {
  const sorted = sortTickets(tickets);
  if (by === "none") return [{ key: "all", label: "", tickets: sorted }];
  const buckets = new Map<string, OrgTicketItem[]>();
  for (const t of sorted) {
    let key: string;
    if (by === "owner") key = t.owner;
    else if (by === "priority") key = t.priority;
    else if (by === "module") key = ticketModule(t.title);
    else if (by === "project") key = ticketProject(t.title);
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
    if (by === "module") return key === "" ? "" : (opts.moduleNames?.get(key) ?? key);
    if (by === "project") return key;
    return key;
  };
  const rankOf = (key: string): number => {
    if (by === "priority") return PRIORITY_RANK[key] ?? 9;
    if (by === "module") return key === "req" ? 0 : key === "resp" ? 1 : key === "demo" ? 2 : 9;
    return 0;
  };
  return [...buckets.entries()]
    .sort(([ak], [bk]) => {
      if (ak === "") return 1;
      if (bk === "") return -1;
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

/** The board as rendered: every column, cards sorted, narrowed by the blocked-only switch, the priority chips and the search box. */
export function boardColumns(
  res: Pick<OrgTicketsResponse, "columns">,
  opts: {
    blockedOnly?: boolean;
    query?: string;
    names?: ReadonlyMap<string, string>;
    /** Priorities to keep; undefined or empty keeps everything. */
    priorities?: readonly string[];
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
        matchesTicketQuery(t, opts.query ?? "", opts.names),
    );
    return { status, tickets: sortTickets(kept) };
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
