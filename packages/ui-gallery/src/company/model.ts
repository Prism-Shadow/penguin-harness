/**
 * The state of the company-mode prototype and everything a reader can do to it. Nothing here
 * calls a server or runs an agent: an action returns the next state, and `letTimePass` stands in
 * for the agents, moving every work session one step of its script (fixtures.ts).
 *
 * A ticket and a work session are two things. The ticket is the record of one piece of work: its
 * goal, where it stands, the decisions and the result; the reader reads it. A work session is
 * the conversation an agent has while it does the work; the reader opens it to watch, or to talk
 * to that agent directly. A ticket has its sessions, each a conversation the ticket links to, and
 * what a session concludes is written back to the ticket.
 *
 * The functions hold the proposal's rules (spec.ts `INVARIANTS`), so the prototype cannot show a
 * state the spec would refuse:
 *
 * - a person's action is taken only on a ticket that waits for exactly that action; anything
 *   else returns the state it was given;
 * - a ticket turns unread only when an agent's step leaves it waiting on the person, and that
 *   step also takes it out of "later"; a person's own action reads it;
 * - a work session stops on its one question until the person answers; the answer is written to
 *   the ticket, then goes into that same session as the person's message, and it carries on;
 * - a delivery sent back goes into the session that delivered it, as the person's message;
 * - what the person says in a session is written to the ticket too, so the ticket alone still
 *   tells the whole story;
 * - a schedule's ticket gets no session before a person accepts it, unless the person has
 *   switched that schedule to automatic;
 * - triage never changes the work, and a ticket that waits on the person cannot be snoozed or
 *   archived.
 *
 * The handbook is how the company learns, and the lead writes to it at fixed moments only: an
 * answer becomes a decision, a delivery sent back becomes a lesson, a delivered document is filed
 * when it is accepted, and a skill distilled from lessons is installed for its employee only when
 * the person accepts it.
 */
import { FIXTURES, SAID_SCRIPT } from "./fixtures";
import { EMPLOYEES } from "./fixtures";
import type { Byline, FixtureId, HandbookDocId, ScriptStep, TicketKind } from "./fixtures";
import { inboxViewOf, INBOX_VIEWS, waitOf } from "./spec";
import type { InboxView, TicketState, Triage } from "./spec";

/** The reader, as a ticket names them. */
export const PERSON = "user:you";

/**
 * Where a ticket came from: something the reader said, a patrol's find, the lead's own proposal,
 * or a budget crossing its warning line.
 */
export type Source = "person" | "patrol" | "lead" | "budget";

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
  /** The notes it was sent back with, oldest first; an empty note is the sample's own, in the dictionary. */
  returns: string[];
  /** What the person said to its work session, oldest first. */
  notes: string[];
  unread: boolean;
}

/** A line of a work session's conversation. */
export type SessionMessage =
  /** The ticket, handed to the session when it opens. */
  | { from: "brief" }
  /** A progress line: the ticket's progress line of that index. */
  | { from: "agent"; step: "progress"; line: number }
  | { from: "agent"; step: "ask" }
  | { from: "agent"; step: "deliver" }
  /** The ticket closed with nothing to review: its result. */
  | { from: "agent"; step: "close" }
  /** The agent's reply to something the person said in the session. */
  | { from: "agent"; step: "noted" }
  | { from: "person"; answer: number; note: string }
  | { from: "person"; sendBack: string }
  | { from: "person"; text: string };

/** A work session: one agent's conversation while it works on one ticket. */
export interface WorkSession {
  id: string;
  ticket: string;
  /** Its place among its ticket's sessions, from 1. */
  n: number;
  messages: SessionMessage[];
}

/** Where a session stands: working, waiting on the person, or over. */
export type SessionStatus = "running" | "answer" | "review" | "ended";

/** What a handbook entry is: the index, a document, a decision, a lesson, or a skill. */
export type HandbookKind = "index" | "doc" | "decision" | "lesson" | "skill";

/** A file under the organization's handbook/. */
export interface HandbookEntry {
  /** Its path under handbook/. */
  path: string;
  kind: HandbookKind;
  /** The ticket it came from; null for the index. */
  ticket: string | null;
  /** A fixed document's words; null for a decision or lesson, written from its ticket. */
  doc: HandbookDocId | null;
  /** A lesson's note: which of its ticket's send-backs. */
  returnIndex?: number;
  /** A skill's employee: it is installed in that employee's own skills. */
  installedOn?: Byline;
}

/** The fixed documents' paths and kinds. */
const FIXED_DOCS: Record<HandbookDocId, { path: string; kind: HandbookKind }> = {
  readme: { path: "README.md", kind: "index" },
  state: { path: "state-of-the-repo.md", kind: "doc" },
  docsLesson: { path: "lessons/docs-both-languages.md", kind: "lesson" },
  bilingualSkill: { path: "skills/bilingual-docs/SKILL.md", kind: "skill" },
};

const fixedEntry = (
  doc: HandbookDocId,
  ticket: string | null,
  installedOn?: Byline,
): HandbookEntry => ({
  ...FIXED_DOCS[doc],
  ticket,
  doc,
  ...(installedOn !== undefined ? { installedOn } : {}),
});

export interface Schedule {
  id: FixtureId;
  /** Its tickets start work directly; off, they are proposed and wait for the person. */
  auto: boolean;
}

/** What the lead says in its conversation: a line of the dictionary, about some tickets. */
export type LeadLine = "proposals" | "filed";

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
  /** Every work session, oldest first. */
  sessions: WorkSession[];
  schedules: Schedule[];
  /** The employees besides the lead, in the order they joined. */
  roles: Byline[];
  /** Each employee's monthly budget, in US dollars. */
  budgets: Record<Byline, number>;
  /** The handbook's files, oldest first. */
  handbook: HandbookEntry[];
  chat: ChatLine[];
  /** What a patrol can still find, in the order it finds it. */
  pool: FixtureId[];
  /** How many tickets the person has asked for in their own words. */
  said: number;
}

/** What letting time pass did to a ticket, for the note the prototype raises. */
export interface PassEvent {
  kind: "progress" | "asked" | "delivered" | "closed" | "proposed" | "started";
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
    notes: [],
    unread: true,
    snoozed: false,
    archived: false,
    ...patch,
  };
}

const working = (patch: Partial<Ticket> = {}): Partial<Ticket> => ({
  status: "in_progress",
  unread: false,
  ...patch,
});

/** A session's conversation so far, as the steps a ticket has taken would have written it. */
function replay(ticket: Ticket): SessionMessage[] {
  const messages: SessionMessage[] = [{ from: "brief" }];
  let line = 0;
  let delivered = 0;
  for (const step of scriptOf(ticket).slice(0, ticket.step)) {
    messages.push(
      step === "progress" ? { from: "agent", step, line: line++ } : { from: "agent", step },
    );
    if (step === "ask" && ticket.answer !== null) {
      messages.push({ from: "person", answer: ticket.answer, note: ticket.answerNote });
    }
    if (step === "deliver") {
      const note = ticket.returns[delivered++];
      if (note !== undefined) messages.push({ from: "person", sendBack: note });
    }
  }
  return messages;
}

/** Every employee's budget as it starts the month. */
const budgetsOf = (): Record<Byline, number> => ({
  lead: EMPLOYEES.lead.budget,
  engineer: EMPLOYEES.engineer.budget,
  verifier: EMPLOYEES.verifier.budget,
});

/** Before anything: the person has not said what the company should look after. */
export function freshState(): CompanyState {
  return {
    stage: "setup",
    mission: null,
    tickets: [],
    sessions: [],
    schedules: [],
    // A company starts with the lead and one engineer; anyone else joins by an accepted proposal.
    roles: ["engineer"],
    budgets: budgetsOf(),
    handbook: [fixedEntry("readme", null)],
    chat: [],
    pool: ["flaky", "lint"],
    said: 0,
  };
}

/**
 * A week in: a question, a delivery, a patrol's proposal and a budget alert wait; a lesson from a
 * send-back has already become a skill; the rest is quiet.
 */
export function weekState(): CompanyState {
  const tickets: Ticket[] = [
    ticketOf("patrol", "lead", { status: "done", unread: false }),
    ticketOf("verifier", "lead", { status: "done", unread: false }),
    ticketOf("survey", "lead", {
      status: "done",
      step: 3,
      progress: 2,
      delivered: true,
      unread: false,
    }),
    ticketOf("types", "patrol", { status: "rejected", unread: false }),
    ticketOf("timeout", "patrol", {
      status: "done",
      step: 2,
      progress: 1,
      delivered: true,
      unread: false,
      snoozed: true,
    }),
    ticketOf("docs", "person", {
      status: "done",
      step: 4,
      progress: 2,
      delivered: true,
      returns: [""],
      unread: false,
    }),
    ticketOf("skill", "lead", { status: "done", unread: false }),
    ticketOf("jitter", "person", working({ step: 1, progress: 1 })),
    ticketOf("connection", "person", {
      status: "review",
      step: 3,
      progress: 2,
      delivered: true,
    }),
    ticketOf(
      "csv",
      "person",
      working({ step: 2, progress: 1, asked: true, blockedBy: PERSON, unread: true }),
    ),
    ticketOf("flaky", "patrol"),
    ticketOf(
      "budget",
      "budget",
      working({ step: 1, asked: true, blockedBy: PERSON, unread: true }),
    ),
  ];
  return {
    stage: "running",
    mission: null,
    tickets,
    // One session for every ticket whose work has started, its conversation as far as the work.
    sessions: tickets
      .filter((ticket) => ticket.step > 0)
      .map((ticket) => ({
        id: `${ticket.id}-1`,
        ticket: ticket.id,
        n: 1,
        messages: replay(ticket),
      })),
    schedules: [{ id: "patrol", auto: false }],
    roles: ["engineer", "verifier"],
    budgets: budgetsOf(),
    handbook: [
      fixedEntry("readme", null),
      fixedEntry("state", "survey"),
      fixedEntry("docsLesson", "docs"),
      fixedEntry("bilingualSkill", "skill", "engineer"),
    ],
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

/** A ticket's work sessions, oldest first. */
export const sessionsOf = (state: CompanyState, ticketId: string): WorkSession[] =>
  state.sessions.filter((session) => session.ticket === ticketId);

/**
 * Where a session stands. Only a ticket's latest session is live, and only while its ticket is in
 * progress or in review; a live session waits when its ticket waits on the person.
 */
export function sessionStatus(state: CompanyState, session: WorkSession): SessionStatus {
  const ticket = find(state, session.ticket);
  const latest = sessionsOf(state, session.ticket).at(-1);
  if (ticket === undefined || latest?.id !== session.id) return "ended";
  if (ticket.status !== "in_progress" && ticket.status !== "review") return "ended";
  const wait = waitOf(ticket);
  return wait === "answer" || wait === "review" ? wait : "running";
}

/** The sessions that are not over, oldest first. */
export const liveSessions = (state: CompanyState): WorkSession[] =>
  state.sessions.filter((session) => sessionStatus(state, session) !== "ended");

/** Open a ticket's next work session, handed the ticket. */
function openSession(state: CompanyState, ticketId: string): CompanyState {
  const n = sessionsOf(state, ticketId).length + 1;
  return {
    ...state,
    sessions: [
      ...state.sessions,
      { id: `${ticketId}-${n}`, ticket: ticketId, n, messages: [{ from: "brief" }] },
    ],
  };
}

/** Add lines to a ticket's latest session. */
function tell(state: CompanyState, ticketId: string, ...messages: SessionMessage[]): CompanyState {
  const latest = sessionsOf(state, ticketId).at(-1);
  if (latest === undefined) return state;
  return {
    ...state,
    sessions: state.sessions.map((session) =>
      session.id === latest.id
        ? { ...session, messages: [...session.messages, ...messages] }
        : session,
    ),
  };
}

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

/** Add a file to the handbook. */
const file = (state: CompanyState, entry: HandbookEntry): CompanyState => ({
  ...state,
  handbook: [...state.handbook, entry],
});

/**
 * Accept a proposal: a task's work session opens, a schedule is switched on, a role joins, or a
 * skill is filed in the handbook and installed for its employee.
 */
export function acceptTicket(state: CompanyState, id: string): CompanyState {
  const ticket = find(state, id);
  if (ticket === undefined || waitOf(ticket) !== "accept" || ticket.fixture === null) return state;
  if (ticket.kind === "task") return openSession(withTicket(state, id, working()), id);
  const settled = withTicket(state, id, { status: "done", unread: false });
  const fixture = FIXTURES[ticket.fixture];
  if (ticket.kind === "schedule") {
    return { ...settled, schedules: [...state.schedules, { id: ticket.fixture, auto: false }] };
  }
  if (ticket.kind === "skill" && fixture.handbook !== undefined) {
    return file(settled, fixedEntry(fixture.handbook, id, fixture.installsOn));
  }
  return { ...settled, roles: [...state.roles, "verifier"] };
}

/** Reject a proposal. The ticket stays on record. */
export function rejectTicket(state: CompanyState, id: string): CompanyState {
  const ticket = find(state, id);
  if (ticket === undefined || waitOf(ticket) !== "accept") return state;
  return withTicket(state, id, { status: "rejected", unread: false });
}

/**
 * Answer a ticket's question. The answer is written to the ticket first; then it goes into the
 * session that asked, as the person's message, and that session carries on.
 */
export function answerTicket(
  state: CompanyState,
  id: string,
  option: number,
  note = "",
): CompanyState {
  const ticket = find(state, id);
  if (ticket === undefined || waitOf(ticket) !== "answer" || !ticket.asked) return state;
  const said = note.trim();
  const answered = withTicket(state, id, {
    asked: false,
    answer: option,
    answerNote: said,
    blockedBy: undefined,
    unread: false,
  });
  // A budget alert's first option raises the employee's budget; the second keeps it.
  const decided =
    ticket.fixture === "budget" && option === 0
      ? { ...answered, budgets: { ...answered.budgets, engineer: 20 } }
      : answered;
  const recorded = file(decided, {
    path: `decisions/${id}.md`,
    kind: "decision",
    ticket: id,
    doc: null,
  });
  return tell(recorded, id, { from: "person", answer: option, note: said });
}

/** Accept a delivery: the ticket is done and its session is over. */
export function approveTicket(state: CompanyState, id: string): CompanyState {
  const ticket = find(state, id);
  if (ticket === undefined || waitOf(ticket) !== "review") return state;
  const done = withTicket(state, id, { status: "done", unread: false });
  // A delivered document joins the handbook once it is accepted.
  const doc = ticket.fixture === null ? undefined : FIXTURES[ticket.fixture].handbook;
  return doc === undefined ? done : file(done, fixedEntry(doc, id));
}

/** Send a delivery back with what to change: the note goes into the session that delivered it. */
export function returnTicket(state: CompanyState, id: string, note: string): CompanyState {
  const ticket = find(state, id);
  const said = note.trim();
  if (ticket === undefined || waitOf(ticket) !== "review" || said === "") return state;
  const returned = withTicket(state, id, {
    status: "in_progress",
    delivered: false,
    returns: [...ticket.returns, said],
    unread: false,
  });
  // What was missed is a lesson: the lead files it before the session takes the note up.
  const learned = file(returned, {
    path: `lessons/${id}-${ticket.returns.length + 1}.md`,
    kind: "lesson",
    ticket: id,
    doc: null,
    returnIndex: ticket.returns.length,
  });
  return tell(learned, id, { from: "person", sendBack: said });
}

/**
 * Something the person says to a live work session, without the lead. The agent answers in the
 * session, and the words are written to the ticket, so what was settled there is on record. A
 * question the session asked still waits for its answer.
 */
export function sayInSession(state: CompanyState, sessionId: string, text: string): CompanyState {
  const said = text.trim();
  const session = state.sessions.find((candidate) => candidate.id === sessionId);
  if (session === undefined || said === "" || sessionStatus(state, session) === "ended")
    return state;
  const ticket = find(state, session.ticket)!;
  const noted = withTicket(state, ticket.id, { notes: [...ticket.notes, said], unread: false });
  return tell(noted, ticket.id, { from: "person", text: said }, { from: "agent", step: "noted" });
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

/** Something said to the lead: it files a ticket, opens its work session, and says so. */
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
  return openSession(
    {
      ...state,
      said: state.said + 1,
      tickets: [...state.tickets, ticket],
      chat: [
        ...state.chat,
        { from: "person", text: said },
        { from: "lead", line: "filed", tickets: [id] },
      ],
    },
    id,
  );
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

/**
 * One step of a ticket's work: a progress line, its question, its delivery, or its close, and
 * what the session says.
 */
function stepTicket(
  ticket: Ticket,
): { ticket: Ticket; event: PassEvent; message: SessionMessage } | null {
  if (ticket.status !== "in_progress" || waitOf(ticket) !== null) return null;
  const step = scriptOf(ticket)[ticket.step];
  if (step === undefined) return null;
  const next = { ...ticket, step: ticket.step + 1 };
  if (step === "close") {
    // Nothing to review: the person's answer was the decision, and carrying it out ends the ticket.
    return {
      ticket: { ...next, status: "done" },
      event: { kind: "closed", id: ticket.id },
      message: { from: "agent", step },
    };
  }
  if (step === "progress") {
    return {
      ticket: { ...next, progress: ticket.progress + 1 },
      event: { kind: "progress", id: ticket.id },
      message: { from: "agent", step, line: ticket.progress },
    };
  }
  // The two steps that leave the ticket waiting: it turns unread, and comes back from "later".
  const waiting = { ...next, unread: true, snoozed: false, archived: false };
  return step === "ask"
    ? {
        ticket: { ...waiting, asked: true, blockedBy: PERSON },
        event: { kind: "asked", id: ticket.id },
        message: { from: "agent", step },
      }
    : {
        ticket: { ...waiting, status: "review", delivered: true },
        event: { kind: "delivered", id: ticket.id },
        message: { from: "agent", step },
      };
}

/**
 * Time passes: every work session takes one step. When none had a step to take, a schedule that
 * is on patrols and files what it finds, proposed, or already in progress when it is automatic.
 */
export function letTimePass(state: CompanyState): { state: CompanyState; events: PassEvent[] } {
  if (state.stage !== "running") return { state, events: [] };
  const events: PassEvent[] = [];
  const said: [string, SessionMessage][] = [];
  const tickets = state.tickets.map((ticket) => {
    const stepped = stepTicket(ticket);
    if (stepped === null) return ticket;
    events.push(stepped.event);
    said.push([ticket.id, stepped.message]);
    return stepped.ticket;
  });
  if (events.length > 0) {
    const moved = said.reduce((next, [id, message]) => tell(next, id, message), {
      ...state,
      tickets,
    });
    return { state: moved, events };
  }

  const schedule = state.schedules[0];
  const found = state.pool[0];
  if (schedule === undefined || found === undefined) return { state, events };
  const filed = schedule.auto ? ticketOf(found, "patrol", working()) : ticketOf(found, "patrol");
  const next = { ...state, tickets: [...state.tickets, filed], pool: state.pool.slice(1) };
  return {
    state: schedule.auto ? openSession(next, found) : next,
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
export function costOf(state: CompanyState, ticket: Ticket): number {
  const sessions = sessionsOf(state, ticket.id).length;
  if (sessions === 0) return 0;
  return ticket.fixture === null ? 0.5 * sessions : FIXTURES[ticket.fixture].cost;
}

/** What the company has spent: every ticket's cost. */
export const spendOf = (state: CompanyState): number =>
  state.tickets.reduce((sum, ticket) => sum + costOf(state, ticket), 0);
