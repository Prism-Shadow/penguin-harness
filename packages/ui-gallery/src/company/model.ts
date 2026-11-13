/**
 * The state of the company-mode prototype and everything a reader can do to it. Nothing here
 * calls a server or runs an agent: an action returns the next state, and `letTimePass` stands in
 * for the agents, moving every work session one step of its script (fixtures.ts).
 *
 * The functions hold the proposal's rules (spec.ts `INVARIANTS`), so the prototype cannot show a
 * state the spec would refuse:
 *
 * - a person's action is taken only on a ticket that waits for exactly that action; anything
 *   else returns the state it was given;
 * - a ticket turns unread only when an agent's step leaves it waiting on the person, and that
 *   step also takes it out of "later"; a person's own action reads it;
 * - a work session stops on its one question until the person answers, and the answer is on the
 *   ticket before the next session opens;
 * - a schedule's ticket gets no session before a person accepts it, unless the person has
 *   switched that schedule to automatic;
 * - triage never changes the work, and a ticket that waits on the person cannot be snoozed or
 *   archived.
 */
import { FIXTURES, SAID_SCRIPT } from "./fixtures";
import type { Byline, FixtureId, ScriptStep, TicketKind } from "./fixtures";
import { inboxViewOf, INBOX_VIEWS, waitOf } from "./spec";
import type { InboxView, TicketState, Triage } from "./spec";

/** The reader, as a ticket names them. */
export const PERSON = "user:you";

/** Where a ticket came from: something the reader said, a patrol's find, or the lead's own proposal. */
export type Source = "person" | "patrol" | "lead";

export interface Ticket extends TicketState, Triage {
  id: string;
  /** The sample ticket whose words it shows; null for one the reader asked for in their own words. */
  fixture: FixtureId | null;
  /** The reader's own words, when there is no fixture. */
  title: string | null;
  kind: TicketKind;
  owner: Byline;
  priority: "P0" | "P1" | "P2";
  source: Source;
  /** How many steps of its script its sessions have taken. */
  step: number;
  /** How many progress lines it holds. */
  progress: number;
  /** Its one question is open. */
  asked: boolean;
  /** The option the person chose, once the question is answered. */
  answer: number | null;
  /** What the person added to their answer. */
  answerNote: string;
  delivered: boolean;
  /** The notes it was sent back with, oldest first. */
  returns: string[];
  /** How many work sessions have opened on it. */
  sessions: number;
  unread: boolean;
}

export interface Schedule {
  id: FixtureId;
  /** Its tickets start work directly; off, they are proposed and wait for the person. */
  auto: boolean;
}

/** What the lead says in its conversation: a line of the dictionary, about some tickets. */
export type LeadLine = "proposals" | "filed" | "recorded";

/** A line of the conversation: the person's own words (or, staged, a ticket's request), or the lead's. */
export type ChatLine =
  | { from: "person"; text: string }
  | { from: "person"; about: string }
  | { from: "lead"; line: LeadLine; tickets: string[] };

export interface CompanyState {
  /** Before the first sentence, or after it. */
  stage: "setup" | "running";
  /** What the person asked the company to look after; null for the sample's own, a dictionary line. */
  mission: string | null;
  /** Oldest first. */
  tickets: Ticket[];
  schedules: Schedule[];
  /** The bylines besides the lead's. */
  roles: Byline[];
  chat: ChatLine[];
  /** What a patrol can still find, in the order it finds it. */
  pool: FixtureId[];
  /** How many tickets the person has asked for in their own words. */
  said: number;
}

/** What letting time pass did to a ticket, for the note the prototype raises. */
export interface PassEvent {
  kind: "progress" | "asked" | "delivered" | "proposed" | "started";
  id: string;
}

function ticketOf(id: FixtureId, source: Source, patch: Partial<Ticket> = {}): Ticket {
  const fixture = FIXTURES[id];
  return {
    id,
    fixture: id,
    title: null,
    kind: fixture.kind,
    owner: fixture.owner,
    priority: fixture.priority,
    source,
    status: "proposed",
    step: 0,
    progress: 0,
    asked: false,
    answer: null,
    answerNote: "",
    delivered: false,
    returns: [],
    sessions: 0,
    unread: true,
    snoozed: false,
    archived: false,
    ...patch,
  };
}

const working = (patch: Partial<Ticket> = {}): Partial<Ticket> => ({
  status: "in_progress",
  sessions: 1,
  unread: false,
  ...patch,
});

/** Before anything: the person has not said what the company should look after. */
export function freshState(): CompanyState {
  return {
    stage: "setup",
    mission: null,
    tickets: [],
    schedules: [],
    roles: [],
    chat: [],
    pool: ["flaky", "lint"],
    said: 0,
  };
}

/** A week in: a question and a delivery wait, a patrol has proposed one thing, the rest is quiet. */
export function weekState(): CompanyState {
  return {
    stage: "running",
    mission: null,
    tickets: [
      ticketOf("patrol", "lead", { status: "done", unread: false }),
      ticketOf("verifier", "lead", { status: "done", unread: false }),
      ticketOf("survey", "lead", {
        status: "done",
        step: 3,
        progress: 2,
        delivered: true,
        sessions: 1,
        unread: false,
      }),
      ticketOf("types", "patrol", { status: "rejected", unread: false }),
      ticketOf("timeout", "patrol", {
        status: "done",
        step: 2,
        progress: 1,
        delivered: true,
        sessions: 1,
        unread: false,
        snoozed: true,
      }),
      ticketOf("docs", "person", {
        status: "done",
        step: 2,
        progress: 1,
        delivered: true,
        sessions: 1,
        unread: false,
      }),
      ticketOf("jitter", "person", working({ step: 1, progress: 1 })),
      ticketOf("connection", "person", {
        status: "review",
        step: 3,
        progress: 2,
        delivered: true,
        sessions: 1,
      }),
      ticketOf(
        "csv",
        "person",
        working({ step: 2, progress: 1, asked: true, blockedBy: PERSON, unread: true }),
      ),
      ticketOf("flaky", "patrol"),
    ],
    schedules: [{ id: "patrol", auto: false }],
    roles: ["engineer", "verifier"],
    chat: [
      { from: "person", about: "csv" },
      { from: "lead", line: "filed", tickets: ["csv"] },
    ],
    pool: ["lint"],
    said: 0,
  };
}

const find = (state: CompanyState, id: string) => state.tickets.find((ticket) => ticket.id === id);

const withTicket = (state: CompanyState, id: string, patch: Partial<Ticket>): CompanyState => ({
  ...state,
  tickets: state.tickets.map((ticket) => (ticket.id === id ? { ...ticket, ...patch } : ticket)),
});

/** The steps a ticket's sessions take: its own, then one round of rework for every time it was sent back. */
export function scriptOf(ticket: Ticket): readonly ScriptStep[] {
  const base = ticket.fixture === null ? SAID_SCRIPT : FIXTURES[ticket.fixture].script;
  return [...base, ...ticket.returns.flatMap((): ScriptStep[] => ["progress", "deliver"])];
}

/**
 * The first sentence. The lead answers with proposals, one thing each: a patrol schedule, a first
 * task, a dedicated role. Nothing starts until the person accepts it.
 */
export function startCompany(state: CompanyState, mission: string): CompanyState {
  const said = mission.trim();
  if (state.stage !== "setup" || said === "") return state;
  const proposals: FixtureId[] = ["patrol", "survey", "verifier"];
  return {
    ...state,
    stage: "running",
    mission: said,
    tickets: proposals.map((id) => ticketOf(id, "lead")),
    chat: [
      { from: "person", text: said },
      { from: "lead", line: "proposals", tickets: proposals },
    ],
  };
}

/** Accept a proposal: work starts, a schedule is switched on, or a role joins. */
export function acceptTicket(state: CompanyState, id: string): CompanyState {
  const ticket = find(state, id);
  if (ticket === undefined || waitOf(ticket) !== "accept" || ticket.fixture === null) return state;
  if (ticket.kind === "task") return withTicket(state, id, working());
  const settled = withTicket(state, id, { status: "done", unread: false });
  return ticket.kind === "schedule"
    ? { ...settled, schedules: [...state.schedules, { id: ticket.fixture, auto: false }] }
    : { ...settled, roles: [...state.roles, "verifier"] };
}

/** Reject a proposal. The ticket stays on record. */
export function rejectTicket(state: CompanyState, id: string): CompanyState {
  const ticket = find(state, id);
  if (ticket === undefined || waitOf(ticket) !== "accept") return state;
  return withTicket(state, id, { status: "rejected", unread: false });
}

/**
 * Answer a ticket's question. The answer is written to the ticket first; then the ticket is
 * unblocked, a new work session opens, and the lead records the decision.
 */
export function answerTicket(
  state: CompanyState,
  id: string,
  option: number,
  note = "",
): CompanyState {
  const ticket = find(state, id);
  if (ticket === undefined || waitOf(ticket) !== "answer" || !ticket.asked) return state;
  const answered = withTicket(state, id, {
    asked: false,
    answer: option,
    answerNote: note.trim(),
    blockedBy: undefined,
    sessions: ticket.sessions + 1,
    unread: false,
  });
  return { ...answered, chat: [...state.chat, { from: "lead", line: "recorded", tickets: [id] }] };
}

/** Accept a delivery. */
export function approveTicket(state: CompanyState, id: string): CompanyState {
  const ticket = find(state, id);
  if (ticket === undefined || waitOf(ticket) !== "review") return state;
  return withTicket(state, id, { status: "done", unread: false });
}

/** Send a delivery back with what to change: a new work session takes it up. */
export function returnTicket(state: CompanyState, id: string, note: string): CompanyState {
  const ticket = find(state, id);
  const said = note.trim();
  if (ticket === undefined || waitOf(ticket) !== "review" || said === "") return state;
  return withTicket(state, id, {
    status: "in_progress",
    delivered: false,
    returns: [...ticket.returns, said],
    sessions: ticket.sessions + 1,
    unread: false,
  });
}

/** Opening a ticket reads it. */
export function readTicket(state: CompanyState, id: string): CompanyState {
  const ticket = find(state, id);
  return ticket === undefined || !ticket.unread ? state : withTicket(state, id, { unread: false });
}

/** Later, archive and restore: the person's own triage. It never changes the work. */
export function triageTicket(
  state: CompanyState,
  id: string,
  action: "snooze" | "archive" | "restore",
): CompanyState {
  const ticket = find(state, id);
  if (ticket === undefined) return state;
  if (action === "restore") {
    return ticket.snoozed || ticket.archived
      ? withTicket(state, id, { snoozed: false, archived: false })
      : state;
  }
  if (waitOf(ticket) !== null) return state;
  return action === "snooze"
    ? withTicket(state, id, { snoozed: true, archived: false })
    : withTicket(state, id, { archived: true, snoozed: false, unread: false });
}

/** Something said to the lead: it files a ticket, already in progress, and says so. */
export function sayToLead(state: CompanyState, text: string): CompanyState {
  const said = text.trim();
  if (state.stage !== "running" || said === "") return state;
  const id = `said-${state.said + 1}`;
  const ticket: Ticket = {
    ...ticketOf("csv", "person", working()),
    id,
    fixture: null,
    title: said,
    owner: "engineer",
    priority: "P2",
  };
  return {
    ...state,
    said: state.said + 1,
    tickets: [...state.tickets, ticket],
    chat: [
      ...state.chat,
      { from: "person", text: said },
      { from: "lead", line: "filed", tickets: [id] },
    ],
  };
}

/** Whether a schedule's tickets start work directly. */
export function setScheduleAuto(state: CompanyState, id: FixtureId, auto: boolean): CompanyState {
  return {
    ...state,
    schedules: state.schedules.map((schedule) =>
      schedule.id === id ? { ...schedule, auto } : schedule,
    ),
  };
}

/** One step of a ticket's work session: a progress line, its question, or its delivery. */
function stepTicket(ticket: Ticket): { ticket: Ticket; event: PassEvent } | null {
  if (ticket.status !== "in_progress" || waitOf(ticket) !== null) return null;
  const step = scriptOf(ticket)[ticket.step];
  if (step === undefined) return null;
  const next = { ...ticket, step: ticket.step + 1 };
  if (step === "progress") {
    return {
      ticket: { ...next, progress: ticket.progress + 1 },
      event: { kind: "progress", id: ticket.id },
    };
  }
  // The two steps that leave the ticket waiting: it turns unread, and comes back from "later".
  const waiting = { ...next, unread: true, snoozed: false, archived: false };
  return step === "ask"
    ? {
        ticket: { ...waiting, asked: true, blockedBy: PERSON },
        event: { kind: "asked", id: ticket.id },
      }
    : {
        ticket: { ...waiting, status: "review", delivered: true },
        event: { kind: "delivered", id: ticket.id },
      };
}

/**
 * Time passes: every work session takes one step. When none had a step to take, a schedule that
 * is on patrols and files what it finds, proposed, or already in progress when it is automatic.
 */
export function letTimePass(state: CompanyState): { state: CompanyState; events: PassEvent[] } {
  if (state.stage !== "running") return { state, events: [] };
  const events: PassEvent[] = [];
  const tickets = state.tickets.map((ticket) => {
    const stepped = stepTicket(ticket);
    if (stepped === null) return ticket;
    events.push(stepped.event);
    return stepped.ticket;
  });
  if (events.length > 0) return { state: { ...state, tickets }, events };

  const schedule = state.schedules[0];
  const found = state.pool[0];
  if (schedule === undefined || found === undefined) return { state, events };
  const filed = schedule.auto ? ticketOf(found, "patrol", working()) : ticketOf(found, "patrol");
  return {
    state: { ...state, tickets: [...state.tickets, filed], pool: state.pool.slice(1) },
    events: [{ kind: schedule.auto ? "started" : "proposed", id: found }],
  };
}

/**
 * A view's tickets. What waits on the reader is listed longest-waiting first, in the order it
 * came in; every other view lists the newest first.
 */
export function ticketsIn(state: CompanyState, view: InboxView): Ticket[] {
  const listed = state.tickets.filter((ticket) => inboxViewOf(ticket) === view);
  return view === "waiting" ? listed : listed.reverse();
}

/** How many tickets each view lists. */
export function inboxCounts(state: CompanyState): Record<InboxView, number> {
  const counts = Object.fromEntries(INBOX_VIEWS.map((view) => [view, 0])) as Record<
    InboxView,
    number
  >;
  for (const ticket of state.tickets) counts[inboxViewOf(ticket)] += 1;
  return counts;
}

/** What a ticket's sessions have cost so far: its sample's figure once work has started. */
export function costOf(ticket: Ticket): number {
  if (ticket.sessions === 0) return 0;
  return ticket.fixture === null ? 0.05 * ticket.sessions : FIXTURES[ticket.fixture].cost;
}

/** What the company has spent: every ticket's cost. */
export const spendOf = (state: CompanyState): number =>
  state.tickets.reduce((sum, ticket) => sum + costOf(ticket), 0);
