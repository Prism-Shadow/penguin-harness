/**
 * The overview page's shaping (pure, unit tested): the employee counts, the board as a
 * segmented bar, today's calendar as an ordered timeline with each instance's outcome, the
 * spend against the budget, the "for me" rows, and whether an organization is still fresh
 * enough that a three-step guide serves it better than an empty dashboard.
 */
import type {
  OrgCalendarItem,
  OrgCalendarOutcome,
  OrgEmployeeItem,
  OrgTicketItem,
  OrgTicketStatus,
} from "@prismshadow/penguin-server/api";
import type { Tone } from "../../lib/tone";
import { TICKET_COLUMNS } from "./ticket-board";

export interface EmployeeCounts {
  total: number;
  /** Employees whose desk session exists. */
  onDesk: number;
  running: number;
  /** Budget-paused. */
  paused: number;
}

export function employeeCounts(
  employees: ReadonlyArray<Pick<OrgEmployeeItem, "state" | "desk">>,
): EmployeeCounts {
  let onDesk = 0;
  let running = 0;
  let paused = 0;
  for (const e of employees) {
    if (e.desk !== undefined) onDesk += 1;
    if (e.state === "running") running += 1;
    else if (e.state === "paused") paused += 1;
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

/** One actionable row of the "for me" section, in the order the section lists them. */
export type PendingRow =
  | { kind: "mentions"; count: number }
  | { kind: "review"; ticket: OrgTicketItem }
  | { kind: "blocked"; ticket: OrgTicketItem };

export function pendingRows(pending: {
  mentions: number;
  reviewTickets: readonly OrgTicketItem[];
  blockedByMe: readonly OrgTicketItem[];
}): PendingRow[] {
  const rows: PendingRow[] = [];
  if (pending.mentions > 0) rows.push({ kind: "mentions", count: pending.mentions });
  for (const ticket of pending.reviewTickets) rows.push({ kind: "review", ticket });
  for (const ticket of pending.blockedByMe) rows.push({ kind: "blocked", ticket });
  return rows;
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

/** The last `n` messages, oldest first (the section reads top to bottom). */
export function chatTail<T>(messages: readonly T[], n: number): T[] {
  return n <= 0 ? [] : messages.slice(-n);
}
