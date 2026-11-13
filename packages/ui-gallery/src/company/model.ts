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
 * The company gets better in two loops, and the person's own verdicts are the only measure:
 *
 * - every ticket: an answer becomes a decision and a delivery sent back a lesson, both in the
 *   handbook; and the employee whose work was sent back, or who was told something in its
 *   session, notes it in its own skill, with no one's approval;
 * - every week, on the lead's own schedule: the lead looks back over the tickets closed since the
 *   last retrospective (how many passed review the first time, how often work was sent back, how
 *   often the person was asked, what an accepted ticket cost), files the retrospective in the
 *   handbook, and proposes what to change as tickets.
 *   Nothing about the company changes until the person accepts it; a skill accepted absorbs the
 *   lesson it came from, so the handbook every employee reads stays short.
 */
import { EMPLOYEES, FIXTURES, RETRO_PROPOSALS, SAID_SCRIPT } from "./fixtures";
import type { Byline, FixtureId, HandbookDocId, ScriptStep, TicketKind } from "./fixtures";
import { inboxViewOf, INBOX_VIEWS, waitOf } from "./spec";
import type { InboxView, TicketState, Triage } from "./spec";

/** The reader, as a ticket names them. */
export const PERSON = "user:you";

/**
 * Where a ticket came from: something the reader said, a patrol's find, the lead's own proposal,
 * or a retrospective's.
 */
export type Source = "person" | "patrol" | "lead" | "retro";

export interface Ticket extends TicketState, Triage {
  id: string;
  /** The sample ticket whose words it shows; null for one the reader asked for in their own words. */
  fixture: FixtureId | null;
  /** The reader's own words, when there is no fixture. */
  title: string | null;
  kind: TicketKind;
  /** The one responsible: it builds, and it starts every session of the ticket. */
  owner: Byline;
  /** Who verifies a delivery before it reaches the person; null when no one does. */
  verifier: Byline | null;
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
  /** What its verifier found and handed back, oldest first; an empty one is the sample's own. */
  findings: string[];
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
  /** The building session hands its delivery to the verifier. */
  | { from: "agent"; step: "handoff" }
  /** The verifying session, opened: the delivery it was handed. */
  | { from: "handed" }
  /** The verifying session's finding, of that index; it goes back to the building session too. */
  | { from: "agent"; step: "found"; finding: number }
  /** The verifier's finding, as the building session receives it. */
  | { from: "verifier"; finding: number }
  /** The verifying session passes the delivery on to the person. */
  | { from: "agent"; step: "verified" }
  /** The agent's reply to something the person said in the session. */
  | { from: "agent"; step: "noted" }
  | { from: "person"; answer: number; note: string }
  | { from: "person"; sendBack: string }
  | { from: "person"; text: string };

/** What a session does on its ticket: build the delivery, or verify it. */
export type SessionRole = "build" | "verify";

/** A work session: one employee's conversation while it works on one ticket. */
export interface WorkSession {
  id: string;
  ticket: string;
  /** Its place among its ticket's sessions, from 1. */
  n: number;
  by: Byline;
  role: SessionRole;
  messages: SessionMessage[];
}

/**
 * Where a session stands: working, waiting on the person, waiting while its delivery is verified,
 * or over.
 */
export type SessionStatus = "running" | "answer" | "review" | "verifying" | "ended";

/** What a handbook entry is: the index, a document, a decision, a lesson, a skill, or a retrospective. */
export type HandbookKind = "index" | "doc" | "decision" | "lesson" | "skill" | "retro";

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
  /** A lesson a skill has absorbed: that skill's path. It no longer counts in the index. */
  mergedInto?: string;
  /** A retrospective's number. */
  retro?: number;
}

/** A retrospective: which closed tickets it looked back over, and what it proposed. */
export interface Retro {
  n: number;
  /** Its window, as indices into `closed`: from, up to (not including). */
  from: number;
  upTo: number;
  proposals: string[];
}

/**
 * Something an employee noted in its own skill, on its own: from a ticket sent back, or from what
 * the person told its session. Each note is the skill's next version.
 */
export interface Learned {
  byline: Byline;
  ticket: string;
}

/** What a stretch of closed tickets says about the work, all of it counted from the tickets. */
export interface Metrics {
  closed: number;
  /** Tasks done. */
  accepted: number;
  /** Tasks done with nothing sent back. */
  firstPass: number;
  sendBacks: number;
  /** Questions the person answered. */
  questions: number;
  /** What an accepted task cost, on average. */
  costPerAccepted: number;
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

/**
 * A schedule: the daily patrol, once its proposal is accepted, or the lead's weekly retrospective,
 * which every company has from the start.
 */
export type ScheduleId = "patrol" | "retro";

export interface Schedule {
  id: ScheduleId;
  /**
   * Its tickets start work directly; off, they are proposed and wait for the person. A
   * retrospective's proposals always wait.
   */
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
  /** The handbook's files, oldest first. */
  handbook: HandbookEntry[];
  /** The schedule that ran last, so the next quiet pass runs the one after it. */
  lastRun: ScheduleId | null;
  /** Ticket ids in the order they closed (done or rejected). */
  closed: string[];
  retros: Retro[];
  learned: Learned[];
  chat: ChatLine[];
  /** What a patrol can still find, in the order it finds it. */
  pool: FixtureId[];
  /** How many tickets the person has asked for in their own words. */
  said: number;
}

/** What letting time pass did to a ticket, for the note the prototype raises. */
export interface PassEvent {
  kind: "progress" | "handed" | "found" | "asked" | "delivered" | "proposed" | "started" | "retro";
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
    verifier: fixture.verifiedBy ?? null,
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
    findings: [],
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

/**
 * A staged ticket's sessions, as its work so far would have written them: the ticket is worked
 * from its start, step by step, through the same rules the prototype runs, with the person's
 * recorded answer and send-backs given where the work waited for them.
 */
function replay(target: Ticket, roles: Byline[]): WorkSession[] {
  const start: Ticket = {
    ...target,
    status: "in_progress",
    step: 0,
    progress: 0,
    asked: false,
    answer: null,
    answerNote: "",
    delivered: false,
    returns: [],
    findings: [],
    blockedBy: undefined,
  };
  let state = openSession(
    { ...freshState(), stage: "running", roles, tickets: [start] },
    target.id,
    "build",
  );
  let returned = 0;
  for (;;) {
    const ticket = find(state, target.id)!;
    if (ticket.step >= target.step) break;
    const wait = waitOf(ticket);
    if (wait === "answer") {
      state = answerTicket(state, target.id, target.answer ?? 0, target.answerNote);
    } else if (wait === "review") {
      state = sendBack(state, target.id, target.returns[returned++] ?? "");
    } else {
      state = stepOne(state, target.id)?.state ?? state;
    }
  }
  return state.sessions;
}

/** Before anything: the person has not said what the company should look after. */
export function freshState(): CompanyState {
  return {
    stage: "setup",
    mission: null,
    tickets: [],
    sessions: [],
    schedules: [{ id: "retro", auto: false }],
    lastRun: null,
    // A company starts with the lead and one engineer; anyone else joins by an accepted proposal.
    roles: ["engineer"],
    handbook: [fixedEntry("readme", null)],
    closed: [],
    retros: [],
    learned: [],
    chat: [],
    pool: ["flaky", "lint"],
    said: 0,
  };
}

/**
 * A week in: a question, a delivery and a patrol's proposal wait; a lesson from a
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
    ticketOf("skill", "retro", { status: "done", unread: false }),
    ticketOf("jitter", "person", working({ step: 1, progress: 1 })),
    ticketOf("connection", "person", {
      status: "review",
      step: 4,
      progress: 2,
      delivered: true,
    }),
    ticketOf(
      "csv",
      "person",
      working({ step: 2, progress: 1, asked: true, blockedBy: PERSON, unread: true }),
    ),
    ticketOf("flaky", "patrol"),
  ];
  const roles: Byline[] = ["engineer", "verifier"];
  return {
    stage: "running",
    mission: null,
    tickets,
    // The sessions of every ticket whose work has started, their conversations as far as the work.
    sessions: tickets
      .filter((ticket) => ticket.step > 0)
      .flatMap((ticket) => replay(ticket, roles)),
    schedules: [
      { id: "retro", auto: false },
      { id: "patrol", auto: false },
    ],
    // The patrol ran last; the next quiet pass is the week's retrospective.
    lastRun: "patrol",
    roles,
    handbook: [
      fixedEntry("readme", null),
      fixedEntry("state", "survey"),
      { ...fixedEntry("docsLesson", "docs"), mergedInto: FIXED_DOCS.bilingualSkill.path },
      { path: "retros/1.md", kind: "retro", ticket: null, doc: null, retro: 1 },
      fixedEntry("bilingualSkill", "skill", "engineer"),
    ],
    // The first retrospective looked back over the first five closed tickets and proposed the skill.
    closed: ["patrol", "verifier", "survey", "docs", "types", "skill", "timeout"],
    retros: [{ n: 1, from: 0, upTo: 5, proposals: ["skill"] }],
    learned: [{ byline: "engineer", ticket: "docs" }],
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

/** Whose turn a ticket's work is: the verifier's while it checks a delivery, else the builder's. */
function turnOf(ticket: Ticket): SessionRole {
  const next = scriptOf(ticket)[ticket.step];
  return waitOf(ticket) === null && (next === "found" || next === "verified") ? "verify" : "build";
}

/**
 * Where a session stands, while its ticket is in progress or in review; otherwise it is over. Of
 * each role, only the ticket's latest session is live. The building session carries the ticket
 * through: it waits when the ticket waits on the person, and while its delivery is verified. A
 * verifying session is live only while it checks; each delivery handed over opens a new one.
 */
export function sessionStatus(state: CompanyState, session: WorkSession): SessionStatus {
  const ticket = find(state, session.ticket);
  if (ticket === undefined || (ticket.status !== "in_progress" && ticket.status !== "review"))
    return "ended";
  const latest = sessionsOf(state, session.ticket)
    .filter((candidate) => candidate.role === session.role)
    .at(-1);
  if (latest?.id !== session.id) return "ended";
  const turn = turnOf(ticket);
  if (session.role === "verify") return turn === "verify" ? "running" : "ended";
  const wait = waitOf(ticket);
  if (wait === "answer" || wait === "review") return wait;
  return turn === "verify" ? "verifying" : "running";
}

/** The sessions that are not over, oldest first. */
export const liveSessions = (state: CompanyState): WorkSession[] =>
  state.sessions.filter((session) => sessionStatus(state, session) !== "ended");

/**
 * Open a ticket's next work session, for its builder or its verifier; the owner starts both. A
 * building session is handed the ticket; a verifying one, the ticket and the delivery.
 */
function openSession(state: CompanyState, ticketId: string, role: SessionRole): CompanyState {
  const ticket = find(state, ticketId);
  const by = role === "build" ? ticket?.owner : ticket?.verifier;
  if (by === undefined || by === null) return state;
  const n = sessionsOf(state, ticketId).length + 1;
  const messages: SessionMessage[] =
    role === "build" ? [{ from: "brief" }] : [{ from: "brief" }, { from: "handed" }];
  return {
    ...state,
    sessions: [
      ...state.sessions,
      { id: `${ticketId}-${n}`, ticket: ticketId, n, by, role, messages },
    ],
  };
}

/** Add lines to one session. */
function tellSession(state: CompanyState, id: string, ...messages: SessionMessage[]): CompanyState {
  return {
    ...state,
    sessions: state.sessions.map((session) =>
      session.id === id ? { ...session, messages: [...session.messages, ...messages] } : session,
    ),
  };
}

/** Add lines to a ticket's latest session of a role. */
function tell(
  state: CompanyState,
  ticketId: string,
  role: SessionRole,
  ...messages: SessionMessage[]
): CompanyState {
  const latest = sessionsOf(state, ticketId)
    .filter((session) => session.role === role)
    .at(-1);
  return latest === undefined ? state : tellSession(state, latest.id, ...messages);
}

/**
 * The steps a ticket's work takes: its own, then one round of rework for every time it was sent
 * back. On a ticket with a verifier, every delivery is handed over and verified first, and the
 * first comes back once when its fixture says the verifier finds something.
 */
export function scriptOf(ticket: Ticket): readonly ScriptStep[] {
  const base = ticket.fixture === null ? SAID_SCRIPT : FIXTURES[ticket.fixture].script;
  const finds = ticket.fixture !== null && FIXTURES[ticket.fixture].finds === true;
  const steps = [...base, ...ticket.returns.flatMap((): ScriptStep[] => ["progress", "deliver"])];
  if (ticket.verifier === null) return steps;
  let first = true;
  return steps.flatMap((step): ScriptStep[] => {
    if (step !== "deliver") return [step];
    const found: ScriptStep[] = first && finds ? ["handoff", "found", "progress"] : [];
    first = false;
    return [...found, "handoff", "verified"];
  });
}

/** A ticket as its work starts: its verifier stays only while that employee is on the team. */
const staffed = (state: CompanyState, ticket: Ticket): Ticket =>
  ticket.verifier !== null && !state.roles.includes(ticket.verifier)
    ? { ...ticket, verifier: null }
    : ticket;

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

/** Record that a ticket closed, once. */
const close = (state: CompanyState, id: string): CompanyState =>
  state.closed.includes(id) ? state : { ...state, closed: [...state.closed, id] };

/** An employee notes something in its own skill. */
const learn = (state: CompanyState, byline: Byline, ticket: string): CompanyState => ({
  ...state,
  learned: [...state.learned, { byline, ticket }],
});

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
  if (ticket.kind === "task") {
    const started = withTicket(state, id, working({ verifier: staffed(state, ticket).verifier }));
    return openSession(started, id, "build");
  }
  const settled = close(withTicket(state, id, { status: "done", unread: false }), id);
  const fixture = FIXTURES[ticket.fixture];
  if (ticket.kind === "schedule") {
    return { ...settled, schedules: [...state.schedules, { id: "patrol", auto: false }] };
  }
  if (ticket.kind === "skill" && fixture.handbook !== undefined) {
    const skill = fixedEntry(fixture.handbook, id, fixture.installsOn);
    // The lesson the skill was distilled from leaves the index: the skill now carries it.
    const handbook = settled.handbook.map((entry) =>
      fixture.merges !== undefined && entry.doc === fixture.merges
        ? { ...entry, mergedInto: skill.path }
        : entry,
    );
    return file({ ...settled, handbook }, skill);
  }
  if (ticket.kind === "change") return settled;
  return { ...settled, roles: [...state.roles, "verifier"] };
}

/** Reject a proposal. The ticket stays on record. */
export function rejectTicket(state: CompanyState, id: string): CompanyState {
  const ticket = find(state, id);
  if (ticket === undefined || waitOf(ticket) !== "accept") return state;
  return close(withTicket(state, id, { status: "rejected", unread: false }), id);
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
  const recorded = file(answered, {
    path: `decisions/${id}.md`,
    kind: "decision",
    ticket: id,
    doc: null,
  });
  return tell(recorded, id, "build", { from: "person", answer: option, note: said });
}

/** Accept a delivery: the ticket is done and its session is over. */
export function approveTicket(state: CompanyState, id: string): CompanyState {
  const ticket = find(state, id);
  if (ticket === undefined || waitOf(ticket) !== "review") return state;
  const done = close(withTicket(state, id, { status: "done", unread: false }), id);
  // A delivered document joins the handbook once it is accepted.
  const doc = ticket.fixture === null ? undefined : FIXTURES[ticket.fixture].handbook;
  return doc === undefined ? done : file(done, fixedEntry(doc, id));
}

/**
 * Send a delivery back with what to change: the note goes into the session that built it, which
 * carries on.
 */
export function returnTicket(state: CompanyState, id: string, note: string): CompanyState {
  const ticket = find(state, id);
  const said = note.trim();
  if (ticket === undefined || waitOf(ticket) !== "review" || said === "") return state;
  return sendBack(state, id, said);
}

/** A send-back, once allowed; an empty note stands for a staged ticket's own, in the dictionary. */
function sendBack(state: CompanyState, id: string, said: string): CompanyState {
  const ticket = find(state, id)!;
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
  // The employee notes it in its own skill too, with no one's approval.
  return tell(learn(learned, ticket.owner, id), id, "build", { from: "person", sendBack: said });
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
  const noted = learn(
    withTicket(state, ticket.id, { notes: [...ticket.notes, said], unread: false }),
    session.by,
    ticket.id,
  );
  return tellSession(
    noted,
    session.id,
    { from: "person", text: said },
    { from: "agent", step: "noted" },
  );
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
    verifier: state.roles.includes("verifier") ? "verifier" : null,
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
    "build",
  );
}

/** Whether a schedule's tickets start work directly. */
export function setScheduleAuto(state: CompanyState, id: ScheduleId, auto: boolean): CompanyState {
  if (id === "retro") return state;
  return {
    ...state,
    schedules: state.schedules.map((schedule) =>
      schedule.id === id ? { ...schedule, auto } : schedule,
    ),
  };
}

/**
 * One step of a ticket's work, in the session whose turn it is: a progress line, the question, a
 * delivery to the person; or, with a verifier, the hand-over that opens a verifying session, a
 * finding written to the ticket and handed back to the building session, or a pass that brings
 * the delivery to the person. Null when the ticket has no step to take.
 */
function stepOne(
  state: CompanyState,
  id: string,
): { state: CompanyState; event: PassEvent } | null {
  const ticket = find(state, id);
  if (ticket === undefined || ticket.status !== "in_progress" || waitOf(ticket) !== null)
    return null;
  const step = scriptOf(ticket)[ticket.step];
  if (step === undefined) return null;
  const next = { step: ticket.step + 1 };
  // The steps that leave the ticket waiting on the person: it turns unread, and comes back from "later".
  const waiting = { ...next, unread: true, snoozed: false, archived: false };
  switch (step) {
    case "progress":
      return {
        state: tell(
          withTicket(state, id, { ...next, progress: ticket.progress + 1 }),
          id,
          "build",
          { from: "agent", step, line: ticket.progress },
        ),
        event: { kind: "progress", id },
      };
    case "ask":
      return {
        state: tell(
          withTicket(state, id, { ...waiting, asked: true, blockedBy: PERSON }),
          id,
          "build",
          {
            from: "agent",
            step,
          },
        ),
        event: { kind: "asked", id },
      };
    case "deliver":
      return {
        state: tell(
          withTicket(state, id, { ...waiting, status: "review", delivered: true }),
          id,
          "build",
          {
            from: "agent",
            step,
          },
        ),
        event: { kind: "delivered", id },
      };
    case "handoff":
      return {
        state: openSession(
          tell(withTicket(state, id, next), id, "build", { from: "agent", step }),
          id,
          "verify",
        ),
        event: { kind: "handed", id },
      };
    case "found": {
      const finding = ticket.findings.length;
      // What the verifier found corrects the builder: it notes it in its own skill too.
      const found = learn(
        withTicket(state, id, { ...next, findings: [...ticket.findings, ""] }),
        ticket.owner,
        id,
      );
      return {
        state: tell(tell(found, id, "verify", { from: "agent", step, finding }), id, "build", {
          from: "verifier",
          finding,
        }),
        event: { kind: "found", id },
      };
    }
    case "verified":
      return {
        state: tell(
          withTicket(state, id, { ...waiting, status: "review", delivered: true }),
          id,
          "verify",
          {
            from: "agent",
            step,
          },
        ),
        event: { kind: "delivered", id },
      };
  }
}

/**
 * Time passes: every work session takes one step. When none had a step to take, time runs on to
 * the next schedule's run, the schedules taking turns: the patrol files what it finds, proposed,
 * or already in progress when it is automatic; the retrospective looks back over what closed
 * since the last one. A run with nothing to do is skipped.
 */
export function letTimePass(state: CompanyState): { state: CompanyState; events: PassEvent[] } {
  if (state.stage !== "running") return { state, events: [] };
  const events: PassEvent[] = [];
  let moved = state;
  for (const ticket of state.tickets) {
    const stepped = stepOne(moved, ticket.id);
    if (stepped === null) continue;
    events.push(stepped.event);
    moved = stepped.state;
  }
  if (events.length > 0) return { state: moved, events };

  const last = state.schedules.findIndex((schedule) => schedule.id === state.lastRun);
  const turns = [...state.schedules.slice(last + 1), ...state.schedules.slice(0, last + 1)];
  for (const schedule of turns) {
    const ran = runSchedule(state, schedule);
    if (ran !== null) return { state: { ...ran.state, lastRun: schedule.id }, events: [ran.event] };
  }
  return { state, events };
}

/** One schedule's run, or null when it has nothing to do. */
function runSchedule(
  state: CompanyState,
  schedule: Schedule,
): { state: CompanyState; event: PassEvent } | null {
  if (schedule.id === "retro") {
    const from = state.retros.at(-1)?.upTo ?? 0;
    if (state.closed.length === from) return null;
    const retro = lookBack(state);
    return { state: retro, event: { kind: "retro", id: String(retro.retros.length) } };
  }
  const found = state.pool[0];
  if (found === undefined) return null;
  const proposed = ticketOf(found, "patrol");
  const filed = schedule.auto ? { ...staffed(state, proposed), ...working() } : proposed;
  const next = { ...state, tickets: [...state.tickets, filed], pool: state.pool.slice(1) };
  return {
    state: schedule.auto ? openSession(next, found, "build") : next,
    event: { kind: schedule.auto ? "started" : "proposed", id: found },
  };
}

/**
 * A retrospective: the lead looks back over the tickets closed since the last one, files it in
 * the handbook, and proposes what to change, each as a ticket waiting on the person.
 */
function lookBack(state: CompanyState): CompanyState {
  const n = state.retros.length + 1;
  const from = state.retros.at(-1)?.upTo ?? 0;
  const proposals = (RETRO_PROPOSALS[n - 1] ?? []).filter((id) => find(state, id) === undefined);
  return {
    ...state,
    tickets: [...state.tickets, ...proposals.map((id) => ticketOf(id, "retro"))],
    retros: [...state.retros, { n, from, upTo: state.closed.length, proposals }],
    handbook: [
      ...state.handbook,
      { path: `retros/${n}.md`, kind: "retro", ticket: null, doc: null, retro: n },
    ],
  };
}

/** What the given closed tickets say about the work. */
export function metricsOf(state: CompanyState, ids: readonly string[]): Metrics {
  const tickets = ids.flatMap((id) => find(state, id) ?? []);
  const accepted = tickets.filter((ticket) => ticket.kind === "task" && ticket.status === "done");
  const cost = accepted.reduce((sum, ticket) => sum + costOf(state, ticket), 0);
  return {
    closed: tickets.length,
    accepted: accepted.length,
    firstPass: accepted.filter((ticket) => ticket.returns.length === 0).length,
    sendBacks: tickets.reduce((sum, ticket) => sum + ticket.returns.length, 0),
    questions: tickets.filter((ticket) => ticket.answer !== null).length,
    costPerAccepted: accepted.length === 0 ? 0 : cost / accepted.length,
  };
}

/** A retrospective's window: the tickets it looked back over. */
export const windowOf = (state: CompanyState, retro: Retro): string[] =>
  state.closed.slice(retro.from, retro.upTo);

/** What an employee's closed tickets say about its work. */
export const employeeMetrics = (state: CompanyState, byline: Byline): Metrics =>
  metricsOf(
    state,
    state.closed.filter((id) => find(state, id)?.owner === byline),
  );

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
