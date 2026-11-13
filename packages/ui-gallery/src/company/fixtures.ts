/**
 * The sample work the prototype is staged with: thirteen tickets' worth of facts that are not
 * language (what kind of thing each is, who does it, the steps its work session takes when the
 * reader lets time pass). Their words are the dictionaries' `tickets`, keyed by the same ids.
 * Everything is fictional; no agent runs.
 */
export type FixtureId =
  | "csv"
  | "connection"
  | "flaky"
  | "jitter"
  | "types"
  | "docs"
  | "timeout"
  | "lint"
  | "survey"
  | "patrol"
  | "verifier"
  | "skill"
  | "patrolScope";

/**
 * What accepting a ticket sets going: work, a patrol schedule, a dedicated role, a skill the lead
 * distilled, installed for the employee who needs it, or a change a retrospective proposed to how
 * the company works (a duty, a schedule's scope), applied as written.
 */
export type TicketKind = "task" | "schedule" | "role" | "skill" | "change";

/**
 * The handbook's fixed documents, whose words are the dictionaries' `handbook.docs`. Decisions
 * and lessons are written from their tickets instead (model.ts).
 */
export type HandbookDocId = "readme" | "state" | "docsLesson" | "bilingualSkill";

/** Whose byline a ticket carries: one of the company's employees. */
export type Byline = "lead" | "engineer" | "verifier";

/**
 * An employee, apart from its words: its Agent id and who it reports to. The id picks the
 * avatar's colour; these three fall a third of the wheel apart, so
 * no two employees share a colour.
 * Its name, title and duties are the dictionaries' `people`. The lead is the one that stays up;
 * the others work only in the sessions of the tickets they own.
 */
export interface Employee {
  agentId: string;
  reportsTo: Byline | null;
}

/**
 * What a million Tokens cost in the sample, input, output and cache together, in US dollars. A
 * ticket's cost is its fixture's; its Tokens are read back from it at this price.
 */
export const USD_PER_MILLION_TOKENS = 3;

/** The company's employees, the lead first. */
export const EMPLOYEES: Record<Byline, Employee> = {
  lead: { agentId: "harness-lead", reportsTo: null },
  engineer: { agentId: "org-engineer", reportsTo: "lead" },
  verifier: { agentId: "org-verifier", reportsTo: "lead" },
};

/**
 * One step a work session takes: it notes progress, stops on its one question, or delivers for
 * review. A session never does anything else that a person sees.
 */
export type ScriptStep = "progress" | "ask" | "deliver";

export interface Fixture {
  kind: TicketKind;
  owner: Byline;
  priority: "P0" | "P1" | "P2";
  /** The steps of its work, in order. A schedule or a role has none: accepting it is the whole of it. */
  script: readonly ScriptStep[];
  /** The option its question recommends, when it asks one. */
  recommended?: number;
  /** What it hands over. */
  deliverable?: string;
  /** What its sessions have cost so far, in US dollars, once work has started. */
  cost: number;
  /** The handbook document it adds once it is done. */
  handbook?: HandbookDocId;
  /** Who a skill is installed for, once accepted. */
  installsOn?: Byline;
  /** The lesson a skill absorbs: once it is installed, the lesson leaves the handbook's index. */
  merges?: HandbookDocId;
}

export const FIXTURES: Record<FixtureId, Fixture> = {
  csv: {
    kind: "task",
    owner: "engineer",
    priority: "P1",
    script: ["progress", "ask", "progress", "deliver"],
    recommended: 0,
    deliverable: "pull/128",
    cost: 4.2,
  },
  connection: {
    kind: "task",
    owner: "engineer",
    priority: "P1",
    script: ["progress", "progress", "deliver"],
    deliverable: "pull/126",
    cost: 3.1,
  },
  flaky: {
    kind: "task",
    owner: "engineer",
    priority: "P1",
    script: ["progress", "deliver"],
    deliverable: "pull/129",
    cost: 1.8,
  },
  jitter: {
    kind: "task",
    owner: "verifier",
    priority: "P2",
    script: ["progress", "progress", "deliver"],
    deliverable: "reports/sidebar-jitter.md",
    cost: 1.2,
  },
  types: {
    kind: "task",
    owner: "engineer",
    priority: "P2",
    script: ["progress", "deliver"],
    cost: 0,
  },
  docs: {
    kind: "task",
    owner: "engineer",
    priority: "P2",
    script: ["progress", "deliver"],
    deliverable: "pull/121",
    cost: 0.9,
  },
  timeout: {
    kind: "task",
    owner: "engineer",
    priority: "P2",
    script: ["progress", "deliver"],
    deliverable: "pull/119",
    cost: 1.4,
  },
  lint: {
    kind: "task",
    owner: "engineer",
    priority: "P2",
    script: ["progress", "deliver"],
    deliverable: "pull/130",
    cost: 0.7,
  },
  survey: {
    kind: "task",
    owner: "lead",
    priority: "P1",
    script: ["progress", "progress", "deliver"],
    deliverable: "handbook/state-of-the-repo.md",
    handbook: "state",
    cost: 2.6,
  },
  patrol: { kind: "schedule", owner: "lead", priority: "P1", script: [], cost: 0 },
  verifier: { kind: "role", owner: "lead", priority: "P2", script: [], cost: 0 },
  skill: {
    kind: "skill",
    owner: "lead",
    priority: "P2",
    script: [],
    cost: 0,
    handbook: "bilingualSkill",
    installsOn: "engineer",
    merges: "docsLesson",
  },
  patrolScope: { kind: "change", owner: "lead", priority: "P2", script: [], cost: 0 },
};

/**
 * How many closed tickets a retrospective waits for in the sample. The spec's default is 10; the
 * sample company set 5, so a reader sees one come round.
 */
export const RETRO_EVERY = 5;

/** What the sample's retrospectives propose, by retrospective: the first, then the second. */
export const RETRO_PROPOSALS: readonly (readonly FixtureId[])[] = [["skill"], ["patrolScope"]];

/** The steps of a ticket the reader asked for in their own words. */
export const SAID_SCRIPT: readonly ScriptStep[] = ["progress", "deliver"];
