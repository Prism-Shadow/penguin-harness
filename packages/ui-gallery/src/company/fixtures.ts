/**
 * The sample work the prototype is staged with: eleven tickets' worth of facts that are not
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
  | "verifier";

/** What accepting a ticket sets going: work, a patrol schedule, or a dedicated role. */
export type TicketKind = "task" | "schedule" | "role";

/** Whose byline a ticket carries: one of the company's employees. */
export type Byline = "lead" | "engineer" | "verifier";

/**
 * An employee, apart from its words: its Agent id, who it reports to, and its monthly budget in
 * US dollars. The id picks the avatar's colour; these three fall a third of the wheel apart, so
 * no two employees share a colour.
 * Its name, title and duties are the dictionaries' `people`. The lead is the one that stays up;
 * the others work only in the sessions of the tickets they own.
 */
export interface Employee {
  agentId: string;
  reportsTo: Byline | null;
  budget: number;
}

/** The company's employees, the lead first. Their budgets add up to the company's. */
export const EMPLOYEES: Record<Byline, Employee> = {
  lead: { agentId: "harness-lead", reportsTo: null, budget: 40 },
  engineer: { agentId: "org-engineer", reportsTo: "lead", budget: 40 },
  verifier: { agentId: "org-verifier", reportsTo: "lead", budget: 20 },
};

/**
 * One step a work session takes: it notes progress, stops on its one question, or delivers.
 * A session never does anything else that a person sees.
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
}

export const FIXTURES: Record<FixtureId, Fixture> = {
  csv: {
    kind: "task",
    owner: "engineer",
    priority: "P1",
    script: ["progress", "ask", "progress", "deliver"],
    recommended: 0,
    deliverable: "pull/128",
    cost: 0.42,
  },
  connection: {
    kind: "task",
    owner: "engineer",
    priority: "P1",
    script: ["progress", "progress", "deliver"],
    deliverable: "pull/126",
    cost: 0.31,
  },
  flaky: {
    kind: "task",
    owner: "engineer",
    priority: "P1",
    script: ["progress", "deliver"],
    deliverable: "pull/129",
    cost: 0.18,
  },
  jitter: {
    kind: "task",
    owner: "verifier",
    priority: "P2",
    script: ["progress", "progress", "deliver"],
    deliverable: "reports/sidebar-jitter.md",
    cost: 0.12,
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
    cost: 0.09,
  },
  timeout: {
    kind: "task",
    owner: "engineer",
    priority: "P2",
    script: ["progress", "deliver"],
    deliverable: "pull/119",
    cost: 0.14,
  },
  lint: {
    kind: "task",
    owner: "engineer",
    priority: "P2",
    script: ["progress", "deliver"],
    deliverable: "pull/130",
    cost: 0.07,
  },
  survey: {
    kind: "task",
    owner: "lead",
    priority: "P1",
    script: ["progress", "progress", "deliver"],
    deliverable: "handbook/state-of-the-repo.md",
    cost: 0.26,
  },
  patrol: { kind: "schedule", owner: "lead", priority: "P1", script: [], cost: 0 },
  verifier: { kind: "role", owner: "lead", priority: "P2", script: [], cost: 0 },
};

/** The steps of a ticket the reader asked for in their own words. */
export const SAID_SCRIPT: readonly ScriptStep[] = ["progress", "deliver"];
