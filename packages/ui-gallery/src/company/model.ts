/**
 * The prototype's state and everything that changes it, as pure functions: each takes the state
 * and returns the next, so the tests drive the company exactly as the reader's clicks do.
 *
 * A company is set up in a conversation with its lead (`startCompany`), or opened a week in
 * (`weekState`). After that, nothing moves until the reader lets time pass (`letTimePass`): an
 * event may arrive and file a ticket, and every ticket the company holds takes one step of its
 * script. The server's rules apply to every step: work over its budget stops, a verifier that
 * would send work back past the round limit stops instead, and work that was not verified never
 * reaches the person. What stops reaches the inbox; nothing else does.
 *
 * Every call the reader makes is written down: in the ticket's decisions, in the handbook when
 * they say so, and, for a send-back, as a lesson in the executor's own skill, a new version over
 * a snapshot of the last, so any change can be rolled back.
 */
import {
  EVENTS,
  EXECUTOR_OF,
  FIXTURES,
  MEMBERS,
  REQUESTS,
  STARTERS,
  WEEK_TICKETS,
} from "./fixtures";
import type {
  ExecutorId,
  FixtureId,
  Member,
  MemberId,
  ModelId,
  Scenario,
  Source,
  Step,
} from "./fixtures";
import { DEFAULT_GRADES, groupOf, waitOf } from "./spec";
import type {
  InboxGroup,
  OutwardAction,
  OutwardGrade,
  TicketStatus,
  Trigger,
  Wait,
  Workbench,
} from "./spec";

export type Halt = "budget" | "rounds";
export type HaltChoice = "more" | "decide" | "stop";

/** One run of a member on a ticket: a line of its bill. */
export interface Run {
  step: Step["k"];
  by: MemberId;
  model: ModelId;
  tokens: number;
  /** The share of input read from the prompt cache, 0–1. */
  cache: number;
  usd: number;
  /** Tool calls the run made: what the folded log holds. */
  tools: number;
}

/** A review comment: the verifier's finding, or the person's note when they send work back. */
export type ReviewEntry =
  | { by: "verifier"; round: number; finding: number }
  | { by: "person"; round: number; text: string; paragraph: number | null; version: number };

/** A call the person made on the ticket, as its Decisions section records it. */
export type Decision =
  | { kind: "ask"; option: string; note: string; filed: boolean }
  | { kind: "halt"; halt: Halt; choice: HaltChoice }
  | { kind: "accept"; outward: OutwardAction | null }
  | { kind: "sendBack" }
  | { kind: "proposal"; accepted: boolean }
  | { kind: "drop" };

export interface Ticket {
  id: string;
  /** The sample work it is. */
  fixture: FixtureId;
  /** A request in the reader's own words, which names it instead of the sample's title. */
  text: string | null;
  workbench: Workbench;
  owner: ExecutorId;
  source: Source;
  status: TicketStatus;
  /** How many steps of its script it has taken. */
  at: number;
  script: readonly Step[];
  budget: number;
  spent: number;
  rounds: { limit: number; used: number };
  asking: boolean;
  halt: Halt | null;
  review: ReviewEntry[];
  decisions: Decision[];
  runs: Run[];
  /** How many times the work was delivered: a document's versions. */
  versions: number;
  outward: OutwardAction | null;
  /** The drafts the reader opened, for an action they send themselves. */
  opened: number[];
  unread: boolean;
}

/** An entry in the handbook: a call written down, a lesson from a send-back, a change applied. */
export type Entry =
  | { id: string; kind: "decision"; ticket: string; option: string; note: string }
  | { id: string; kind: "lesson"; ticket: string; member: ExecutorId; review: ReviewEntry }
  | { id: string; kind: "change"; ticket: string };

/** One version of an executor's private skill: the handbook entry that made it, or none for the first. */
export interface SkillVersion {
  v: number;
  entry: string | null;
}

export interface Skill {
  versions: SkillVersion[];
  /** The version in use; any later one stays as a snapshot to roll forward to. */
  current: number;
}

/** A line of the lead's conversation once the company runs. */
export type ChatLine =
  | { from: "person"; request: FixtureId | null; text: string | null }
  | { from: "lead"; request: FixtureId | null; text: string | null; filed: string | null };

export interface CompanySettings {
  budget: number;
  rounds: number;
  grades: Record<OutwardAction, OutwardGrade>;
  triggers: Record<Trigger, boolean>;
}

export const DEFAULT_SETTINGS: CompanySettings = {
  budget: 5,
  rounds: 2,
  grades: DEFAULT_GRADES,
  triggers: { github: true, message: true, callback: true, patrol: true, review: true },
};

/** What the reader can try, as the tour lists it, one list per flow. */
export const TOUR = {
  onboarding: ["pick", "answer", "edit", "create"],
  daily: [
    "ask",
    "accept",
    "outward",
    "halt",
    "autoReturn",
    "sendBack",
    "event",
    "trace",
    "request",
    "rollback",
    "review",
  ],
} as const;
export type TourItem = (typeof TOUR)[keyof typeof TOUR][number];

export interface CompanyState {
  stage: "onboarding" | "running";
  scenario: Scenario | null;
  hired: ExecutorId[];
  members: Record<MemberId, Member>;
  settings: CompanySettings;
  tickets: Ticket[];
  passes: number;
  handbook: Entry[];
  skills: Record<ExecutorId, Skill>;
  chat: ChatLine[];
  /** How many reviews the lead has held. */
  reviewed: number;
  benchmark: "idle" | "submitted";
  did: TourItem[];
  nextId: number;
}

const FIRST_SKILL: Skill = { versions: [{ v: 1, entry: null }], current: 1 };

/** A company before its first sentence: the lead's welcome waits. */
export function freshState(): CompanyState {
  return {
    stage: "onboarding",
    scenario: null,
    hired: [],
    members: MEMBERS,
    settings: DEFAULT_SETTINGS,
    tickets: [],
    passes: 0,
    handbook: [],
    skills: { dev: FIRST_SKILL, research: FIRST_SKILL, ops: FIRST_SKILL },
    chat: [],
    reviewed: 0,
    benchmark: "idle",
    did: [],
    nextId: 1,
  };
}

export function did(state: CompanyState, item: TourItem): CompanyState {
  return state.did.includes(item) ? state : { ...state, did: [...state.did, item] };
}

const replace = (state: CompanyState, ticket: Ticket): CompanyState => ({
  ...state,
  tickets: state.tickets.map((candidate) => (candidate.id === ticket.id ? ticket : candidate)),
});

export function ticketOf(state: CompanyState, id: string): Ticket | undefined {
  return state.tickets.find((ticket) => ticket.id === id);
}

const stateOf = (ticket: Ticket) => ({
  status: ticket.status,
  asking: ticket.asking,
  halted: ticket.halt !== null,
});

export const ticketWait = (ticket: Ticket): Wait | null => waitOf(stateOf(ticket));
export const ticketGroup = (ticket: Ticket): InboxGroup => groupOf(stateOf(ticket));

/** A group's tickets, the newest first, as the inbox lists them. */
export function ticketsIn(state: CompanyState, group: InboxGroup): Ticket[] {
  return state.tickets.filter((ticket) => ticketGroup(ticket) === group).reverse();
}

export function groupCounts(state: CompanyState): Record<InboxGroup, number> {
  const counts: Record<InboxGroup, number> = { decide: 0, moving: 0, settled: 0 };
  for (const ticket of state.tickets) counts[ticketGroup(ticket)] += 1;
  return counts;
}

function newTicket(state: CompanyState, fixture: FixtureId, key: string = fixture): Ticket {
  const staged = FIXTURES[fixture];
  return {
    id: key,
    fixture,
    text: null,
    workbench: staged.workbench,
    owner: staged.change?.member ?? EXECUTOR_OF[staged.workbench],
    source: staged.source,
    status: staged.change !== undefined ? "proposed" : "working",
    at: 0,
    script: staged.script,
    budget: staged.budget,
    spent: 0,
    rounds: { limit: state.settings.rounds, used: 0 },
    asking: false,
    halt: null,
    review: [],
    decisions: [],
    runs: [],
    versions: 0,
    outward: staged.outward ?? null,
    opened: [],
    unread: true,
  };
}

/** Who runs a step, on which model, and what the run's bill says. */
function runOf(state: CompanyState, ticket: Ticket, step: Step): Run {
  const by: MemberId = step.k === "fail" || step.k === "pass" ? "verifier" : ticket.owner;
  const model = state.members[by].model;
  // Tokens follow cost at a rate per model family; the figures are the prototype's own.
  const rate = model.startsWith("deepseek") ? 2_600_000 : 1_400_000;
  const before = ticket.runs.length;
  return {
    step: step.k,
    by,
    model,
    tokens: Math.round(step.usd * rate),
    cache: Math.min(0.92, 0.45 + before * 0.08),
    usd: step.usd,
    tools: step.k === "work" ? 9 + ((before * 7) % 13) : step.k === "deliver" ? 3 : 6,
  };
}

/** What a step of time did, as the bar under the page reports it. */
export type PassEvent =
  | { kind: "arrived"; id: string }
  | { kind: "delivered"; id: string }
  | { kind: "returned"; id: string }
  | { kind: "passed"; id: string }
  | { kind: "asked"; id: string }
  | { kind: "halted"; id: string; halt: Halt };

/** Adds a version to a member's skill for a handbook entry; the version before stays as its snapshot. */
function bumpSkill(state: CompanyState, member: ExecutorId, entry: string): CompanyState {
  const skill = state.skills[member];
  const v = skill.versions.length + 1;
  return {
    ...state,
    skills: {
      ...state.skills,
      [member]: { versions: [...skill.versions, { v, entry }], current: v },
    },
  };
}

/** A send-back, written down as a lesson in the handbook and in the executor's skill. */
function learn(state: CompanyState, ticket: Ticket, review: ReviewEntry): CompanyState {
  const id = `lesson-${state.nextId}`;
  const entry: Entry = { id, kind: "lesson", ticket: ticket.id, member: ticket.owner, review };
  return bumpSkill(
    { ...state, nextId: state.nextId + 1, handbook: [...state.handbook, entry] },
    ticket.owner,
    id,
  );
}

/** One step of a ticket's work, or the server's refusal of it. A waiting or settled ticket takes none. */
function stepTicket(
  state: CompanyState,
  id: string,
): { state: CompanyState; event: PassEvent | null } {
  const ticket = ticketOf(state, id);
  if (ticket === undefined) return { state, event: null };
  const moving = ticket.status === "working" || ticket.status === "verifying";
  const step = ticket.script[ticket.at];
  if (!moving || ticketWait(ticket) !== null || step === undefined) return { state, event: null };
  // The server's two limits: what the work may cost, and how often it may be sent back.
  if (ticket.spent + step.usd > ticket.budget + 1e-9) {
    return {
      state: replace(state, { ...ticket, halt: "budget", unread: true }),
      event: { kind: "halted", id, halt: "budget" },
    };
  }
  if (step.k === "fail" && ticket.rounds.used >= ticket.rounds.limit) {
    return {
      state: replace(state, { ...ticket, halt: "rounds", unread: true }),
      event: { kind: "halted", id, halt: "rounds" },
    };
  }
  let next: Ticket = {
    ...ticket,
    at: ticket.at + 1,
    spent: Math.round((ticket.spent + step.usd) * 100) / 100,
    runs: [...ticket.runs, runOf(state, ticket, step)],
  };
  let after = state;
  let event: PassEvent | null = null;
  if (step.k === "deliver") {
    next = { ...next, status: "verifying", versions: next.versions + 1 };
    event = { kind: "delivered", id };
  } else if (step.k === "fail") {
    const review: ReviewEntry = {
      by: "verifier",
      round: ticket.rounds.used + 1,
      finding: step.finding,
    };
    next = {
      ...next,
      status: "working",
      rounds: { ...ticket.rounds, used: ticket.rounds.used + 1 },
      review: [...ticket.review, review],
    };
    after = learn(after, next, review);
    event = { kind: "returned", id };
  } else if (step.k === "pass") {
    next = { ...next, status: "deciding", unread: true };
    event = { kind: "passed", id };
  } else if (step.k === "ask") {
    next = { ...next, asking: true, unread: true };
    event = { kind: "asked", id };
  }
  return { state: replace(after, next), event };
}

/** An event from outside: the lead files its ticket at once, when that trigger is on. */
function arrive(state: CompanyState, id: FixtureId): CompanyState {
  if (ticketOf(state, id) !== undefined) return state;
  const fixture = FIXTURES[id];
  const trigger: Trigger = fixture.source === "github" ? "github" : "message";
  if (!state.settings.triggers[trigger]) return state;
  if (!state.hired.includes(EXECUTOR_OF[fixture.workbench])) return state;
  return { ...state, tickets: [...state.tickets, newTicket(state, id)] };
}

/** Every moving ticket takes one step; an event due on this pass arrives first. */
export function letTimePass(state: CompanyState): { state: CompanyState; events: PassEvent[] } {
  const passes = state.passes + 1;
  let next: CompanyState = { ...state, passes };
  const events: PassEvent[] = [];
  for (const due of EVENTS.filter((event) => event.pass === passes)) {
    const before = next.tickets.length;
    next = arrive(next, due.ticket);
    if (next.tickets.length > before) {
      events.push({ kind: "arrived", id: due.ticket });
      next = did(next, "event");
    }
  }
  for (const ticket of next.tickets) {
    const stepped = stepTicket(next, ticket.id);
    next = stepped.state;
    if (stepped.event !== null) events.push(stepped.event);
  }
  if (events.some((event) => event.kind === "returned")) next = did(next, "autoReturn");
  return { state: next, events };
}

/** Takes a ticket's steps as the sample week did, answering its question as recommended. */
function replay(state: CompanyState, id: string, attempts: number): CompanyState {
  let next = state;
  for (let i = 0; i < attempts; i += 1) {
    const ticket = ticketOf(next, id)!;
    if (ticket.asking) {
      next = answerAsk(next, id, FIXTURES[ticket.fixture].ask?.recommended ?? "", "", false);
    }
    next = stepTicket(next, id).state;
  }
  return next;
}

/** The sample company, a week in. */
export function weekState(): CompanyState {
  let state: CompanyState = {
    ...freshState(),
    stage: "running",
    scenario: "solo",
    hired: ["dev", "research", "ops"],
  };
  for (const id of WEEK_TICKETS) {
    const fixture = FIXTURES[id];
    state = { ...state, tickets: [...state.tickets, newTicket(state, id)] };
    state = replay(state, id, fixture.week ?? 0);
    const ticket = ticketOf(state, id)!;
    if (fixture.settled !== undefined) {
      const decision: Decision =
        fixture.settled === "done" ? { kind: "accept", outward: ticket.outward } : { kind: "drop" };
      state = replace(state, {
        ...ticket,
        status: fixture.settled,
        decisions: [...ticket.decisions, decision],
        unread: false,
      });
    }
  }
  return {
    ...state,
    // Two calls the reader wrote down earlier in the week.
    handbook: [
      { id: "decision-discount", kind: "decision", ticket: "discount", option: "drop", note: "" },
      { id: "decision-guide", kind: "decision", ticket: "guide", option: "tone", note: "" },
      ...state.handbook,
    ],
    reviewed: 1,
    did: [],
  };
}

/** The reader's answers in the lead's onboarding conversation, and their edits to its plan. */
export interface Setup {
  scenario: Scenario;
  work: readonly Workbench[];
  budget: number;
  rounds: number;
  events: boolean;
  models: Partial<Record<ExecutorId, ModelId>>;
}

/** The executors a company needs for its work: one per kind of work, three at most. */
export function hiresFor(work: readonly Workbench[]): ExecutorId[] {
  const needed = new Set(work.map((kind) => EXECUTOR_OF[kind]));
  return (["dev", "research", "ops"] as const).filter((id) => needed.has(id));
}

/** The company the reader confirmed: its team, its limits, and the first ticket of each kind of work. */
export function startCompany(state: CompanyState, setup: Setup): CompanyState {
  const hired = hiresFor(setup.work);
  const members = { ...state.members };
  for (const id of hired) {
    const model = setup.models[id];
    if (model !== undefined) members[id] = { ...members[id], model };
  }
  let next: CompanyState = {
    ...state,
    stage: "running",
    scenario: setup.scenario,
    hired,
    members,
    settings: {
      ...state.settings,
      budget: setup.budget,
      rounds: setup.rounds,
      triggers: {
        ...state.settings.triggers,
        github: setup.events,
        message: setup.events,
        callback: setup.events,
      },
    },
    tickets: [],
  };
  for (const kind of setup.work) {
    const ticket = newTicket(next, STARTERS[kind]);
    next = {
      ...next,
      tickets: [...next.tickets, { ...ticket, budget: Math.min(ticket.budget, setup.budget) }],
    };
  }
  return did(next, "create");
}

export function readTicket(state: CompanyState, id: string): CompanyState {
  const ticket = ticketOf(state, id);
  return ticket === undefined || !ticket.unread
    ? state
    : replace(state, { ...ticket, unread: false });
}

/** The answer to a ticket's question, written back to it and, if the reader says so, to the handbook. */
export function answerAsk(
  state: CompanyState,
  id: string,
  option: string,
  note: string,
  file: boolean,
): CompanyState {
  const ticket = ticketOf(state, id);
  if (ticket === undefined || !ticket.asking) return state;
  let next: Ticket = {
    ...ticket,
    asking: false,
    decisions: [...ticket.decisions, { kind: "ask", option, note, filed: file }],
  };
  if (option === "stop") next = { ...next, status: "dropped" };
  // The full run is a large experiment: it comes with the budget it needs.
  if (option === "full") next = { ...next, budget: next.budget + 18 };
  let after = replace(state, next);
  if (file) {
    after = {
      ...after,
      nextId: after.nextId + 1,
      handbook: [
        ...after.handbook,
        { id: `decision-${after.nextId}`, kind: "decision", ticket: id, option, note },
      ],
    };
  }
  return did(after, "ask");
}

/** The reader's call on a ticket the server stopped. */
export function answerHalt(state: CompanyState, id: string, choice: HaltChoice): CompanyState {
  const ticket = ticketOf(state, id);
  if (ticket === undefined || ticket.halt === null) return state;
  const halt = ticket.halt;
  let next: Ticket = {
    ...ticket,
    halt: null,
    decisions: [...ticket.decisions, { kind: "halt", halt, choice }],
  };
  if (choice === "more") {
    next =
      halt === "budget"
        ? { ...next, budget: ticket.budget * 2 }
        : { ...next, rounds: { ...ticket.rounds, limit: ticket.rounds.limit + 1 } };
  } else if (choice === "decide") {
    // The reader settles it themselves: the work comes to them as it stands.
    next = { ...next, status: "deciding", at: ticket.script.length };
  } else {
    next = { ...next, status: "dropped" };
  }
  return did(replace(state, next), "halt");
}

/** Accepts verified work, which approves the outward action it carries. */
export function acceptWork(state: CompanyState, id: string): CompanyState {
  const ticket = ticketOf(state, id);
  if (ticket === undefined || ticket.status !== "deciding") return state;
  const next = did(
    replace(state, {
      ...ticket,
      status: "done",
      decisions: [...ticket.decisions, { kind: "accept", outward: ticket.outward }],
    }),
    "accept",
  );
  return ticket.outward === null ? next : did(next, "outward");
}

/** Opens one of a ticket's drafts for the reader to send themselves. */
export function openDraft(state: CompanyState, id: string, index: number): CompanyState {
  const ticket = ticketOf(state, id);
  if (ticket === undefined || ticket.opened.includes(index)) return state;
  return did(replace(state, { ...ticket, opened: [...ticket.opened, index] }), "outward");
}

/**
 * Sends verified work back with the reader's note, on a paragraph or on the whole: the executor
 * takes it again, the verifier checks it again, and the note becomes a lesson in the executor's
 * skill.
 */
export function sendBack(
  state: CompanyState,
  id: string,
  text: string,
  paragraph: number | null = null,
): CompanyState {
  const ticket = ticketOf(state, id);
  if (ticket === undefined || ticket.status !== "deciding" || text.trim() === "") return state;
  const review: ReviewEntry = {
    by: "person",
    round: ticket.rounds.used,
    text: text.trim(),
    paragraph,
    version: ticket.versions,
  };
  const next: Ticket = {
    ...ticket,
    status: "working",
    script: [
      ...ticket.script.slice(0, ticket.at),
      { k: "work", usd: 0.4 },
      { k: "deliver", usd: 0.2 },
      { k: "pass", usd: 0.3 },
    ],
    review: [...ticket.review, review],
    decisions: [...ticket.decisions, { kind: "sendBack" }],
  };
  return did(learn(replace(state, next), next, review), "sendBack");
}

/** Accepts or declines a change the lead proposed. Accepting applies it as written. */
export function answerProposal(state: CompanyState, id: string, accepted: boolean): CompanyState {
  const ticket = ticketOf(state, id);
  if (ticket === undefined || ticket.status !== "proposed") return state;
  let next = replace(state, {
    ...ticket,
    status: accepted ? "done" : "dropped",
    decisions: [...ticket.decisions, { kind: "proposal", accepted }],
  });
  const change = FIXTURES[ticket.fixture].change;
  if (!accepted || change === undefined) return next;
  const entry = `change-${next.nextId}`;
  next = {
    ...next,
    nextId: next.nextId + 1,
    handbook: [...next.handbook, { id: entry, kind: "change", ticket: id }],
  };
  if (change.model !== undefined) return setModel(next, change.member, change.model);
  // A rule for one member goes into its skill, over a snapshot of the version before.
  return bumpSkill(next, change.member, entry);
}

export function dropTicket(state: CompanyState, id: string): CompanyState {
  const ticket = ticketOf(state, id);
  if (ticket === undefined || ticket.status === "done" || ticket.status === "dropped") return state;
  return replace(state, {
    ...ticket,
    status: "dropped",
    asking: false,
    halt: null,
    decisions: [...ticket.decisions, { kind: "drop" }],
  });
}

/** Puts an executor's skill back to an earlier version; the later ones stay to roll forward to. */
export function rollback(state: CompanyState, member: ExecutorId, v: number): CompanyState {
  const skill = state.skills[member];
  if (!skill.versions.some((version) => version.v === v)) return state;
  return did(
    { ...state, skills: { ...state.skills, [member]: { ...skill, current: v } } },
    "rollback",
  );
}

/** What the reader asks the lead for: a suggested request, or one in their own words. */
export function askLead(
  state: CompanyState,
  request: FixtureId | null,
  text: string | null,
): CompanyState {
  return {
    ...state,
    chat: [
      ...state.chat,
      { from: "person", request, text },
      { from: "lead", request, text, filed: null },
    ],
  };
}

/** Files the ticket the lead previewed at `line` of its conversation. */
export function fileRequest(state: CompanyState, line: number): CompanyState {
  const preview = state.chat[line];
  if (preview === undefined || preview.from !== "lead" || preview.filed !== null) return state;
  // A request in the reader's own words is staged as a document, the commonest work.
  const fixture: FixtureId = preview.request ?? "pricing";
  const key =
    preview.request !== null && ticketOf(state, preview.request) === undefined
      ? preview.request
      : `request-${state.nextId}`;
  const ticket: Ticket = {
    ...newTicket(state, fixture, key),
    text: preview.request === null ? preview.text : null,
    source: "user",
    budget: state.settings.budget,
    unread: false,
  };
  const chat = state.chat.map((candidate, i) =>
    i === line && candidate.from === "lead" ? { ...candidate, filed: key } : candidate,
  );
  return did(
    { ...state, nextId: state.nextId + 1, tickets: [...state.tickets, ticket], chat },
    "request",
  );
}

/** The requests the lead still suggests: those not asked for yet. */
export function suggestions(state: CompanyState): FixtureId[] {
  return REQUESTS.filter((id) => !state.chat.some((line) => line.request === id));
}

export function setModel(state: CompanyState, member: MemberId, model: ModelId): CompanyState {
  return { ...state, members: { ...state.members, [member]: { ...state.members[member], model } } };
}

export function setLimits(
  state: CompanyState,
  limits: { budget?: number; rounds?: number },
): CompanyState {
  return { ...state, settings: { ...state.settings, ...limits } };
}

export function setGrade(
  state: CompanyState,
  action: OutwardAction,
  grade: OutwardGrade,
): CompanyState {
  return {
    ...state,
    settings: { ...state.settings, grades: { ...state.settings.grades, [action]: grade } },
  };
}

export function setTrigger(state: CompanyState, trigger: Trigger, on: boolean): CompanyState {
  return {
    ...state,
    settings: { ...state.settings, triggers: { ...state.settings.triggers, [trigger]: on } },
  };
}

/** How one executor has done: what passed the verifier the first time, what came back, what it cost. */
export interface Metrics {
  verified: number;
  firstPass: number;
  rework: number;
  tickets: number;
  spent: number;
}

export function metricsOf(state: CompanyState, member: ExecutorId): Metrics {
  const owned = state.tickets.filter(
    (ticket) => ticket.owner === member && ticket.status !== "proposed",
  );
  const verified = owned.filter((ticket) => ticket.runs.some((run) => run.step === "pass"));
  return {
    verified: verified.length,
    firstPass: verified.filter((ticket) => !ticket.review.some((entry) => entry.by === "verifier"))
      .length,
    rework: owned.reduce((sum, ticket) => sum + ticket.review.length, 0),
    tickets: owned.length,
    spent: owned.reduce((sum, ticket) => sum + ticket.spent, 0),
  };
}

export const spendOf = (state: CompanyState) =>
  state.tickets.reduce((sum, ticket) => sum + ticket.spent, 0);

/**
 * The lead's review: it reads every executor's figures and proposes a change. In the sample the
 * second review finds the ledger work dearer than it needs to be, and proposes a cheaper model.
 */
export function runReview(state: CompanyState): CompanyState {
  const next = did(state, "review");
  if (!next.hired.includes("ops") || ticketOf(next, "cheaperModel") !== undefined) return next;
  return {
    ...next,
    reviewed: next.reviewed + 1,
    tickets: [...next.tickets, newTicket(next, "cheaperModel")],
  };
}

export function submitBenchmark(state: CompanyState): CompanyState {
  return { ...state, benchmark: "submitted" };
}
