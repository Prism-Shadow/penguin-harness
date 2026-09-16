/**
 * The overview page's shaping (pure, unit tested): the employee counts, the board as a
 * segmented bar, today's calendar as an ordered timeline with each instance's outcome, the
 * spend against the budget, the inbox — what names the reader, what is stuck and what has
 * landed, newest first — and whether an organization is still fresh enough that a three-step
 * guide serves it better than an empty dashboard.
 */
import type {
  OrgCalendarItem,
  OrgCalendarOutcome,
  OrgEmployeeItem,
  OrgEmployeeState,
  OrgInbox,
  OrgTicketItem,
  OrgTicketStatus,
} from "@prismshadow/penguin-server/api";
import type { Tone } from "../../lib/tone";
import { DEFAULT_CHANNEL_ID } from "./channel-list";
import { TICKET_COLUMNS } from "./ticket-board";

export interface EmployeeCounts {
  total: number;
  /** Employees whose desk session exists. */
  onDesk: number;
  running: number;
  /** Budget-paused. */
  paused: number;
}

/**
 * The employee tallies. `liveStates` is what the session list says each employee is doing
 * (org-sessions.ts, liveEmployeeStates), which outranks the chart's own `state`: that snapshot
 * is re-read on organization events and a run ending publishes none, so the running count
 * would otherwise keep counting employees that had already stopped. An employee the map does
 * not name — or a page that passes no map at all — falls back to the snapshot.
 */
export function employeeCounts(
  employees: ReadonlyArray<Pick<OrgEmployeeItem, "agentId" | "state" | "desk">>,
  liveStates?: ReadonlyMap<string, OrgEmployeeState>,
): EmployeeCounts {
  let onDesk = 0;
  let running = 0;
  let paused = 0;
  for (const e of employees) {
    if (e.desk !== undefined) onDesk += 1;
    const state = liveStates?.get(e.agentId) ?? e.state;
    if (state === "running") running += 1;
    else if (state === "paused") paused += 1;
  }
  return { total: employees.length, onDesk, running, paused };
}

export interface BoardSegment {
  status: OrgTicketStatus;
  count: number;
  /** 0–1 share of the whole board; 0 on an empty board. */
  share: number;
}

export interface BoardSummary {
  segments: BoardSegment[];
  total: number;
  /** proposed + in_progress + review: what is still moving. */
  open: number;
}

/** The board as a segmented bar: every column in lifecycle order, its count and its share. */
export function boardSummary(board: Partial<Record<OrgTicketStatus, number>>): BoardSummary {
  const total = TICKET_COLUMNS.reduce((n, c) => n + (board[c] ?? 0), 0);
  const segments = TICKET_COLUMNS.map((status) => {
    const count = board[status] ?? 0;
    return { status, count, share: total === 0 ? 0 : count / total };
  });
  const open = (board.proposed ?? 0) + (board.in_progress ?? 0) + (board.review ?? 0);
  return { segments, total, open };
}

/** The bar's fill per column, in the same tones the ticket status badges wear (done takes a heavier neutral, as its badge does). */
export const BOARD_SEGMENT_TONE: Record<OrgTicketStatus, Tone | "done"> = {
  proposed: "muted",
  in_progress: "busy",
  review: "attention",
  done: "done",
  rejected: "danger",
};

/** What today's timeline says about one instance: its recorded outcome, or that it is still ahead. */
export type TimelineMark = OrgCalendarOutcome | "upcoming";

export interface TimelineEntry {
  key: string;
  agentId: string;
  title: string;
  /** Epoch ms of the instance shown: the last firing today, else the next one; null when the event carries neither. */
  at: number | null;
  mark: TimelineMark;
}

export interface TodaySummary {
  entries: TimelineEntry[];
  total: number;
  fired: number;
  queued: number;
  /** missed + error: instances that did not run as planned. */
  failed: number;
  paused: number;
  upcoming: number;
}

const parse = (iso: string | undefined): number | null => {
  if (iso === undefined) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
};

/** Today's events in time order, each with the mark its outcome earns; unknown times sort last. */
export function todaySummary(
  today: ReadonlyArray<
    Pick<
      OrgCalendarItem,
      "agentId" | "name" | "title" | "lastFiredAt" | "nextFireAt" | "lastOutcome"
    >
  >,
): TodaySummary {
  const counts = { fired: 0, queued: 0, failed: 0, paused: 0, upcoming: 0 };
  const entries: TimelineEntry[] = today.map((ev) => {
    const mark: TimelineMark = ev.lastOutcome ?? "upcoming";
    if (mark === "fired") counts.fired += 1;
    else if (mark === "queued") counts.queued += 1;
    else if (mark === "paused") counts.paused += 1;
    else if (mark === "upcoming") counts.upcoming += 1;
    else counts.failed += 1;
    return {
      key: `${ev.agentId}/${ev.name}`,
      agentId: ev.agentId,
      title: ev.title ?? ev.name,
      at: parse(ev.lastFiredAt) ?? parse(ev.nextFireAt),
      mark,
    };
  });
  entries.sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity) || a.key.localeCompare(b.key));
  return { entries, total: today.length, ...counts };
}

/** The tone a timeline mark takes: fired is done well, queued waits, missed and error failed, paused recedes, upcoming waits on time. */
export const TIMELINE_TONE: Record<TimelineMark, Tone> = {
  fired: "success",
  queued: "attention",
  paused: "muted",
  missed: "danger",
  error: "danger",
  upcoming: "attention",
};

export interface SpendSummaryView {
  cost: number;
  budget: number | null;
  /** cost / budget, unclamped; null without a budget. */
  ratio: number | null;
  /** budget − cost; negative when over; null without a budget. */
  remaining: number | null;
}

export function spendSummary(spend: {
  cost: number;
  budget?: number;
  ratio?: number;
}): SpendSummaryView {
  if (spend.budget === undefined || spend.budget <= 0) {
    return { cost: spend.cost, budget: null, ratio: null, remaining: null };
  }
  return {
    cost: spend.cost,
    budget: spend.budget,
    ratio: spend.ratio ?? spend.cost / spend.budget,
    remaining: spend.budget - spend.cost,
  };
}

/**
 * How many rows the inbox holds. Past this the reader is better served by the channel and the
 * board themselves, and the section stops being something a person can scan.
 */
export const INBOX_ROWS = 40;

/**
 * What an inbox row is about — the three things the organization has to say to a person:
 * something was said TO them, something is stuck, something is finished. The order is also how
 * rows of the same instant are ranked.
 */
export type InboxCategory = "mention" | "blocked" | "done";

const CATEGORY_ORDER: Record<InboxCategory, number> = {
  mention: 0,
  blocked: 1,
  done: 2,
};

/** Where a row leads: the channel it was said in, or the ticket it is about. */
export type InboxTarget =
  { kind: "channel"; channelId: string } | { kind: "ticket"; ticketId: string };

export interface InboxRow {
  key: string;
  category: InboxCategory;
  title: string;
  /** The aside after the title: who said it, who owns it, what it waits for. */
  detail?: string;
  /** ISO 8601, or null when the source carries no time at all. */
  time: string | null;
  tone: Tone;
  target: InboxTarget;
}

export interface InboxInput {
  /**
   * The three lists as the organization detail sends them. A server older than the field sends
   * none, which is an empty inbox rather than an error: every row here is a convenience the
   * pages behind it also offer.
   */
  inbox: OrgInbox | undefined;
  /**
   * A principal's display name. A function rather than a map because `all` and `system` have
   * localized names: the page passes its own `principalLabel` bound to the employee names.
   */
  names: (principal: string) => string;
}

/** The first line of a message that carries anything; "" when the whole text is blank. */
function firstLine(text: string): string {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed !== "") return trimmed;
  }
  return "";
}

/**
 * A ticket's own time. Ticket ids are `yyyy-mm-dd-<slug>` and the board item carries no
 * timestamp, so the day it was filed is the only time the inbox can rank it by; null for an
 * id that does not start with a date.
 */
function ticketTime(ticketId: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})-/.exec(ticketId);
  if (m === null) return null;
  const iso = `${m[1]}T00:00:00.000Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/**
 * A blocked ticket's aside: why it is stuck, then who it waits on. The reason is what the
 * reader acts on and the principal is who they act through, so the reason leads; either half
 * may be missing, and a ticket blocked with neither recorded carries no aside at all.
 */
function blockedDetail(ticket: OrgTicketItem, names: (principal: string) => string): string {
  const reason = ticket.blocked?.trim() ?? "";
  const waitsOn =
    ticket.blockedBy === undefined || ticket.blockedBy === "" ? "" : names(ticket.blockedBy);
  return [reason, waitsOn].filter((part) => part !== "").join(" · ");
}

/**
 * The inbox as one list, newest first: the messages that name the reader (or everyone), the
 * tickets that are blocked, and the tickets closed as done this period. Nothing else — a
 * dashboard that repeats the whole channel is a second channel, and what earns a place here is
 * what is addressed to the reader, what has stopped, and what has landed.
 *
 * Rows without a time sort last (a ticket whose id carries no date and that was never stamped
 * closed), ties fall back to the category order and then the key, and the list is capped at
 * `INBOX_ROWS`.
 */
export function inboxRows(input: InboxInput): InboxRow[] {
  const rows: InboxRow[] = [];

  for (const message of input.inbox?.mentions ?? []) {
    rows.push({
      key: `mention/${message.id}`,
      category: "mention",
      title: firstLine(message.text),
      detail: input.names(message.sender),
      time: message.time,
      tone: "attention",
      target: { kind: "channel", channelId: DEFAULT_CHANNEL_ID },
    });
  }

  for (const ticket of input.inbox?.blockedTickets ?? []) {
    const detail = blockedDetail(ticket, input.names);
    rows.push({
      key: `blocked/${ticket.ticketId}`,
      category: "blocked",
      title: ticket.title,
      ...(detail !== "" ? { detail } : {}),
      time: ticketTime(ticket.ticketId),
      tone: "attention",
      target: { kind: "ticket", ticketId: ticket.ticketId },
    });
  }

  for (const ticket of input.inbox?.doneTickets ?? []) {
    rows.push({
      key: `done/${ticket.ticketId}`,
      category: "done",
      title: ticket.title,
      ...(ticket.owner !== undefined ? { detail: input.names(ticket.owner) } : {}),
      // A ticket closed before the field existed still has the day it was filed to rank by.
      time: ticket.closedAt ?? ticketTime(ticket.ticketId),
      // Nothing is asked of the reader: the row is news, and its mark recedes.
      tone: "muted",
      target: { kind: "ticket", ticketId: ticket.ticketId },
    });
  }

  return rows
    .map((row) => ({ row, ms: row.time === null ? null : parse(row.time) }))
    .sort((a, b) => {
      if (a.ms === null || b.ms === null) {
        if (a.ms !== b.ms) return a.ms === null ? 1 : -1;
      } else if (a.ms !== b.ms) return b.ms - a.ms;
      return (
        CATEGORY_ORDER[a.row.category] - CATEGORY_ORDER[b.row.category] ||
        a.row.key.localeCompare(b.row.key)
      );
    })
    .slice(0, INBOX_ROWS)
    .map((entry) => entry.row);
}

/** The inbox's filter chips, in rendered order: everything, then one per category. */
export type InboxFilter = "all" | InboxCategory;
export const INBOX_FILTERS: readonly InboxFilter[] = ["all", "mention", "blocked", "done"];

/** Whether a chip admits a row: its own category, and "all" everything. */
export function inboxMatches(row: InboxRow, filter: InboxFilter): boolean {
  return filter === "all" || row.category === filter;
}

/** How many rows each chip would show. */
export function inboxCounts(rows: readonly InboxRow[]): Record<InboxFilter, number> {
  const counts: Record<InboxFilter, number> = {
    all: rows.length,
    mention: 0,
    blocked: 0,
    done: 0,
  };
  for (const row of rows) {
    for (const filter of INBOX_FILTERS) {
      if (filter !== "all" && inboxMatches(row, filter)) counts[filter] += 1;
    }
  }
  return counts;
}

/** The three steps a new organization walks: talk to the CEO, hire, schedule. */
export type FirstStep = "ceo" | "hire" | "schedule";
export const FIRST_STEPS: readonly FirstStep[] = ["ceo", "hire", "schedule"];

export interface FirstStepsState {
  /** True while the guide replaces the dashboard: nobody hired and nothing on the board. */
  fresh: boolean;
  done: Record<FirstStep, boolean>;
  /** The first step not yet done, or null when all three are. */
  next: FirstStep | null;
}

/**
 * Whether the organization is still at its first steps, and which of them are done. The
 * guide stands only while no one but the CEO is employed and the board is empty; hiring or
 * filing a ticket means the organization is at work, and the dashboard takes over even if
 * no calendar event exists yet.
 */
export function firstSteps(input: {
  employeeCount: number;
  boardTotal: number;
  ceoDeskOpened: boolean;
  calendarCount: number;
}): FirstStepsState {
  const done: Record<FirstStep, boolean> = {
    ceo: input.ceoDeskOpened,
    hire: input.employeeCount > 1,
    schedule: input.calendarCount > 0,
  };
  const fresh = input.employeeCount <= 1 && input.boardTotal === 0;
  const next = FIRST_STEPS.find((step) => !done[step]) ?? null;
  return { fresh, done, next };
}

/** Characters of a mission the hero's single clamped line holds, near enough to guess by. */
const MISSION_ONE_LINE = 48;

/**
 * Whether the hero's mission fold should offer its toggle before the browser has measured
 * anything: a mission that carries a line break, or one longer than a line holds. The page
 * corrects this from the element's own overflow once it has laid out, so the guess only has to
 * be right often enough that the toggle does not flicker in on the first paint.
 */
export function missionClampedGuess(mission: string): boolean {
  return mission.includes("\n") || mission.trim().length > MISSION_ONE_LINE;
}
