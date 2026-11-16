/**
 * The sample company runs PenguinHarness itself: its code, its docs, blog and community, and the
 * evaluation of new models, one employee to each part. The sample work it is staged with is
 * seventeen tickets' worth of facts that are not
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
  | "patrolScope"
  | "release"
  | "community"
  | "discussion"
  | "evals";

/**
 * What accepting a ticket sets going: work, a skill the lead distilled, installed for the employee
 * who needs it, or a change a retrospective proposed to how the company works (a duty, a
 * schedule's scope), applied as written. A patrol schedule and a dedicated role are in the staged
 * week's history only: a new company sets both up as it starts (model.ts `startCompany`).
 */
export type TicketKind = "task" | "schedule" | "role" | "skill" | "change";

/**
 * The handbook's fixed documents, whose words are the dictionaries' `handbook.docs`. Decisions
 * and lessons are written from their tickets instead (model.ts), and how-we-work.md from the
 * company's settings.
 */
export type HandbookDocId = "readme" | "howWeWork" | "state" | "docsLesson" | "bilingualSkill";

/** Whose byline a ticket carries: one of the company's employees. */
export type Byline = "lead" | "engineer" | "writer" | "researcher" | "verifier";

/**
 * A part of the work one employee owns: engineering (the code), operations (the docs, the blog,
 * the community) and research (evaluating models, following the papers). A company staffs the
 * parts its mission needs; the verifier is not a part, it checks the parts' deliveries when the
 * company verifies them.
 */
export type Part = "engineer" | "writer" | "researcher";
export const PARTS: readonly Part[] = ["engineer", "writer", "researcher"];

/** The folder the company works in: the Project's workspace. */
export const WORKSPACE = "~/code/penguin-harness";

/**
 * The missions the setup page suggests, as the parts each needs; their words are the
 * dictionaries' `setup.missions`, in the same order. The first is the sample company's own.
 */
export const MISSION_PARTS: readonly (readonly Part[])[] = [
  ["engineer", "writer", "researcher"],
  ["engineer"],
  ["writer"],
  ["researcher", "writer"],
];

/** The task the lead proposes first for each part it staffs, beside its own survey. */
export const FIRST_TASK: Record<Part, FixtureId> = {
  engineer: "flaky",
  writer: "release",
  researcher: "evals",
};

/**
 * An employee, apart from its words: its Agent id and who it reports to. The id picks the
 * avatar's colour; these five fall at least a sixth of the wheel apart, so no two employees
 * share a colour.
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
  writer: { agentId: "org-community", reportsTo: "lead" },
  researcher: { agentId: "org-study", reportsTo: "lead" },
  verifier: { agentId: "org-verifier", reportsTo: "lead" },
};

/**
 * One step a ticket's work takes. The building session notes progress, stops on its one question,
 * and delivers: straight to the person's review, or, on a ticket with a verifier, handed to a
 * verifying session, which either finds something and hands it back to the building session, or
 * passes it on to the person. A fixture's script names `deliver` only; the verifying steps are
 * written in when the ticket has a verifier (`scriptOf`).
 */
export type ScriptStep = "progress" | "ask" | "deliver" | "handoff" | "found" | "verified";

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
  /** Who verifies its delivery before the person sees it, while that employee is on the team. */
  verifiedBy?: Byline;
  /** Its first verification finds something to fix. */
  finds?: boolean;
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
    verifiedBy: "verifier",
    finds: true,
  },
  connection: {
    kind: "task",
    owner: "engineer",
    priority: "P1",
    script: ["progress", "progress", "deliver"],
    deliverable: "pull/126",
    cost: 3.1,
    verifiedBy: "verifier",
  },
  flaky: {
    kind: "task",
    owner: "engineer",
    priority: "P1",
    script: ["progress", "deliver"],
    deliverable: "pull/129",
    cost: 1.8,
    verifiedBy: "verifier",
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
    owner: "writer",
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
    deliverable: "handbook/state-of-the-project.md",
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
    installsOn: "writer",
    merges: "docsLesson",
  },
  patrolScope: { kind: "change", owner: "lead", priority: "P2", script: [], cost: 0 },
  release: {
    kind: "task",
    owner: "writer",
    priority: "P1",
    script: ["progress", "progress", "deliver"],
    deliverable: "changelog/0.3.md",
    cost: 2.3,
    verifiedBy: "verifier",
    finds: true,
  },
  community: {
    kind: "task",
    owner: "writer",
    priority: "P2",
    script: ["progress", "deliver"],
    deliverable: "reports/community-week-46.md",
    cost: 1.1,
  },
  discussion: {
    kind: "task",
    owner: "writer",
    priority: "P2",
    script: ["progress", "deliver"],
    cost: 0.6,
  },
  evals: {
    kind: "task",
    owner: "researcher",
    priority: "P1",
    script: ["progress", "progress", "deliver"],
    deliverable: "reports/new-models-eval.md",
    cost: 6.4,
    verifiedBy: "verifier",
  },
};

/** What the sample's retrospectives propose, by retrospective: the first, then the second. */
export const RETRO_PROPOSALS: readonly (readonly FixtureId[])[] = [["skill"], ["patrolScope"]];

/** The steps of a ticket the reader asked for in their own words. */
export const SAID_SCRIPT: readonly ScriptStep[] = ["progress", "deliver"];
