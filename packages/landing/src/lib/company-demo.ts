/**
 * What the /company page replays and charts: one fictional day of one inbox, scripted by hand (no
 * agent ran). Three runs follow one another, each starting from the inbox the one before it left:
 * a patrol that proposes work, a request that stops on one question, and a delivery.
 *
 * A step is one event: who acted, at what time, and what it wrote to a ticket. The steps carry no
 * "this reaches the person" flag. `foldInbox` reads it from the ticket: an event reaches the person
 * when it leaves a ticket waiting on them for a new reason (lib/company-spec.ts `waitOf`), and that
 * is also the only thing that marks a ticket unread; a person's own step marks it read.
 *
 * `LIFE` is one ticket's life on one time axis, for the lifecycle chart: the stretches it waits on
 * the person, the stretches an agent works, and the work sessions inside those.
 *
 * test/company-demo.test.ts holds the runs to the spec's rules.
 */
import { waitOf } from "./company-spec";
import type { TicketState, Wait } from "./company-spec";

export type TicketId = "flaky_export" | "bump_types" | "export_csv";
export type Actor = "schedule" | "lead" | "session" | "person" | "server";

/** The person every run's inbox belongs to. */
export const DEMO_PERSON = "user:alice";
/** The schedule entry the patrol runs on. */
export const DEMO_PATROL = "schedule:daily-triage";

export interface DemoTicket extends TicketState {
  id: TicketId;
  /** The words of the file name, after its date. */
  slug: string;
  owner: string;
  source: string;
  unread: boolean;
  /** Its one question is open. */
  ask: boolean;
  /** Its question has an answer on record. */
  decided: boolean;
  /** How many progress lines it holds. */
  progress: number;
  sessions: readonly string[];
  deliverables: readonly string[];
}

type TicketPatch = Partial<Omit<DemoTicket, "id" | "slug" | "unread">>;

export interface DemoStep {
  id: string;
  /** The wall clock, `hh:mm`. */
  at: string;
  actor: Actor;
  /** The ticket the event writes to; an event with none changes no ticket. */
  ticket?: TicketId;
  /** The ticket's first state, when the event creates it. */
  create?: Omit<DemoTicket, "unread">;
  patch?: TicketPatch;
}

export type ScenarioId = "patrol" | "decide" | "deliver";

export interface DemoScenario {
  id: ScenarioId;
  /** The ticket whose file the player shows. */
  subject: TicketId;
  steps: readonly DemoStep[];
}

const ticket = (
  id: TicketId,
  slug: string,
  source: string,
  status: DemoTicket["status"],
): Omit<DemoTicket, "unread"> => ({
  id,
  slug,
  source,
  status,
  owner: "agent:lead",
  ask: false,
  decided: false,
  progress: 0,
  sessions: [],
  deliverables: [],
});

export const SCENARIOS = [
  {
    id: "patrol",
    subject: "flaky_export",
    steps: [
      { id: "patrol_due", at: "09:00", actor: "schedule" },
      {
        id: "propose_flaky",
        at: "09:01",
        actor: "lead",
        ticket: "flaky_export",
        create: ticket("flaky_export", "fix-flaky-export-test", DEMO_PATROL, "proposed"),
      },
      {
        id: "propose_bump",
        at: "09:01",
        actor: "lead",
        ticket: "bump_types",
        create: ticket("bump_types", "bump-node-types", DEMO_PATROL, "proposed"),
      },
      {
        id: "accept_flaky",
        at: "09:20",
        actor: "person",
        ticket: "flaky_export",
        patch: { status: "in_progress" },
      },
      {
        id: "reject_bump",
        at: "09:20",
        actor: "person",
        ticket: "bump_types",
        patch: { status: "rejected" },
      },
      {
        id: "session_flaky",
        at: "09:21",
        actor: "server",
        ticket: "flaky_export",
        patch: { sessions: ["s_f1"] },
      },
    ],
  },
  {
    id: "decide",
    subject: "export_csv",
    steps: [
      { id: "say_csv", at: "10:00", actor: "person" },
      {
        id: "file_csv",
        at: "10:00",
        actor: "lead",
        ticket: "export_csv",
        create: ticket("export_csv", "export-csv", DEMO_PERSON, "in_progress"),
      },
      {
        id: "session_csv",
        at: "10:01",
        actor: "server",
        ticket: "export_csv",
        patch: { sessions: ["s_c1"] },
      },
      {
        id: "progress_read",
        at: "10:05",
        actor: "session",
        ticket: "export_csv",
        patch: { progress: 1 },
      },
      {
        id: "ask_stream",
        at: "10:05",
        actor: "session",
        ticket: "export_csv",
        patch: { ask: true, blockedBy: DEMO_PERSON },
      },
      {
        id: "answer_stream",
        at: "11:30",
        actor: "person",
        ticket: "export_csv",
        patch: { ask: false, blockedBy: undefined, decided: true },
      },
      {
        id: "session_resume",
        at: "11:30",
        actor: "server",
        ticket: "export_csv",
        patch: { sessions: ["s_c1", "s_c2"] },
      },
    ],
  },
  {
    id: "deliver",
    subject: "export_csv",
    steps: [
      {
        id: "progress_done",
        at: "12:38",
        actor: "session",
        ticket: "export_csv",
        patch: { progress: 2 },
      },
      {
        id: "hand_over",
        at: "12:40",
        actor: "session",
        ticket: "export_csv",
        patch: { status: "review", deliverables: ["pull/128"] },
      },
      {
        id: "accept_result",
        at: "14:00",
        actor: "person",
        ticket: "export_csv",
        patch: { status: "done" },
      },
      { id: "record_rule", at: "14:01", actor: "lead" },
    ],
  },
] as const satisfies readonly DemoScenario[];

export type StepId = (typeof SCENARIOS)[number]["steps"][number]["id"];

/** One event as the player lists it. */
export interface DemoEvent {
  id: StepId;
  at: string;
  actor: Actor;
  /** The reason the event left a ticket waiting on the person, when it did. */
  reaches: Wait | null;
}

export interface InboxState {
  /** The tickets in the order they came in. */
  tickets: DemoTicket[];
  events: DemoEvent[];
}

function applyStep(
  tickets: DemoTicket[],
  step: DemoStep,
): { tickets: DemoTicket[]; event: DemoEvent } {
  const before = tickets.find((candidate) => candidate.id === step.ticket);
  const written: DemoTicket | undefined = step.create
    ? { ...step.create, unread: false }
    : before && step.patch
      ? { ...before, ...step.patch }
      : before;
  const wait = written ? waitOf(written) : null;
  const reaches = wait !== null && (before === undefined || waitOf(before) !== wait) ? wait : null;
  const after =
    written === undefined
      ? undefined
      : {
          ...written,
          unread: reaches !== null ? true : step.actor === "person" ? false : written.unread,
        };
  const next =
    after === undefined
      ? tickets
      : before === undefined
        ? [...tickets, after]
        : tickets.map((candidate) => (candidate.id === after.id ? after : candidate));
  return {
    tickets: next,
    event: { id: step.id as StepId, at: step.at, actor: step.actor, reaches },
  };
}

function fold(initial: readonly DemoTicket[], steps: readonly DemoStep[]): InboxState {
  let tickets = [...initial];
  const events: DemoEvent[] = [];
  for (const step of steps) {
    const applied = applyStep(tickets, step);
    tickets = applied.tickets;
    events.push(applied.event);
  }
  return { tickets, events };
}

/** The inbox a run starts from: what every run before it left. */
export function initialInbox(run: number): DemoTicket[] {
  return fold(
    [],
    SCENARIOS.slice(0, run).flatMap((scenario): readonly DemoStep[] => scenario.steps),
  ).tickets;
}

/** A run after its first `count` events: the inbox, and those events as the player lists them. */
export function foldInbox(run: number, count: number): InboxState {
  const steps: readonly DemoStep[] = SCENARIOS[run]!.steps;
  return fold(initialInbox(run), steps.slice(0, count));
}

/** The words a ticket's file needs, from the dictionaries. */
export interface TicketWords {
  title: string;
  progress: readonly string[];
  question?: string;
  options?: readonly string[];
  /** The answer on record, as its line under `## Decisions`. */
  decision?: string;
}

/** The fictional day's month and date, as the ticket path writes them. */
const DEMO_MONTH = "2026-11";
const DEMO_DATE = "2026-11-13";

export const ticketPath = (state: Pick<DemoTicket, "status" | "slug">) =>
  `tickets/${DEMO_MONTH}/${state.status}/${DEMO_DATE}-${state.slug}.md`;

/**
 * A ticket's file as the player shows it: the frontmatter fields the run touches, in the file's
 * order, then the sections that hold something. `notify`, `priority` and `history` are left out.
 */
export function ticketFileLines(state: DemoTicket, words: TicketWords): string[] {
  const list = (items: readonly string[]) => `[${items.join(", ")}]`;
  return [
    "---",
    `title: ${words.title}`,
    `status: ${state.status}`,
    `owner: ${state.owner}`,
    `source: ${state.source}`,
    ...(state.blockedBy !== undefined ? [`blocked_by: ${state.blockedBy}`] : []),
    ...(state.ask
      ? [
          "ask:",
          `  question: ${words.question ?? ""}`,
          `  options: ${list(words.options ?? [])}`,
          "  recommended: 0",
        ]
      : []),
    ...(state.deliverables.length > 0 ? [`deliverables: ${list(state.deliverables)}`] : []),
    `sessions: ${list(state.sessions)}`,
    "---",
    ...(state.progress > 0
      ? ["## Progress", ...words.progress.slice(0, state.progress).map((line) => `- ${line}`)]
      : []),
    ...(state.decided && words.decision !== undefined
      ? ["## Decisions", `- ${words.decision}`]
      : []),
  ];
}

/** A stretch of a ticket's life, in minutes since it was filed. */
export interface Span {
  begin: number;
  end: number;
}

/** A stretch in one status: waiting on the person for a reason, or an agent's to move. */
export interface LifePhase extends Span {
  status: DemoTicket["status"];
  wait: Wait | null;
}

/**
 * One ticket from a patrol's proposal to done, with one question on the way: filed at 09:00,
 * accepted twenty minutes later, stopped on its question at 10:05, answered at 11:30, handed over
 * at 12:40 and accepted at 14:00. A work session runs inside each stretch the agent has.
 */
export const LIFE: { startHour: number; total: number; phases: LifePhase[]; sessions: Span[] } = {
  startHour: 9,
  total: 300,
  phases: [
    { begin: 0, end: 20, status: "proposed", wait: "accept" },
    { begin: 20, end: 65, status: "in_progress", wait: null },
    { begin: 65, end: 150, status: "in_progress", wait: "answer" },
    { begin: 150, end: 220, status: "in_progress", wait: null },
    { begin: 220, end: 300, status: "review", wait: "review" },
  ],
  sessions: [
    { begin: 21, end: 65 },
    { begin: 151, end: 220 },
  ],
};
