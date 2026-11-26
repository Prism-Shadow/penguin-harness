/**
 * The facts the prototype is staged with, none of them language: who can work here, on which
 * machine and model, and the sample work, each ticket with the steps it takes when the reader
 * lets time pass. The words for all of it are the dictionaries', keyed by the same ids.
 *
 * The sample is a one-person company, Floe Studio, that keeps up an open-source notes app and
 * sells a hosted plan: code, a model evaluation, long documents, a contract and an invoice check,
 * and replies to its community. Everything is fictional; no agent runs.
 */
import type { OutwardAction, Workbench } from "./spec";

/** Every employee is named after a penguin species. */
export type Species = "emperor" | "chinstrap" | "gentoo" | "adelie" | "king";

/** Each species' Agent id, which picks its avatar's colour. */
export const AGENT_ID: Record<Species, string> = {
  emperor: "harness-lead",
  chinstrap: "org-verifier",
  gentoo: "org-engineer",
  adelie: "org-study",
  king: "org-scout",
};

/** The fewest hands a company can run on: one lead, up to three executors, one verifier. */
export type MemberId = "lead" | "dev" | "research" | "ops" | "verifier";
export const EXECUTORS = ["dev", "research", "ops"] as const;
export type ExecutorId = (typeof EXECUTORS)[number];

export type MachineId = "laptop" | "gpu" | "cloud";
export const MACHINES: readonly MachineId[] = ["laptop", "gpu", "cloud"];

export const MODELS = [
  "deepseek-v4-pro",
  "deepseek-v4-flash",
  "glm-5.3",
  "qwen3.8-max",
  "minimax-m3",
] as const;
export type ModelId = (typeof MODELS)[number];
export const MODEL_NAME: Record<ModelId, string> = {
  "deepseek-v4-pro": "DeepSeek V4 Pro",
  "deepseek-v4-flash": "DeepSeek V4 Flash",
  "glm-5.3": "GLM-5.3",
  "qwen3.8-max": "Qwen3.8 Max",
  "minimax-m3": "MiniMax M3",
};

/** What a member may touch. The words are the dictionaries' `perms`. */
export type Perm =
  "files" | "branch" | "tests" | "gpu" | "drafts" | "readonly" | "noMerge" | "tickets";

export interface Member {
  id: MemberId;
  species: Species;
  machine: MachineId;
  model: ModelId;
  perms: readonly Perm[];
}

/**
 * Each member as a company starts with it. The verifier runs on another model family than the
 * executors and holds a read-only token of its own, so it can never pass its own work.
 */
export const MEMBERS: Record<MemberId, Member> = {
  lead: {
    id: "lead",
    species: "emperor",
    machine: "cloud",
    model: "deepseek-v4-pro",
    perms: ["tickets"],
  },
  dev: {
    id: "dev",
    species: "gentoo",
    machine: "laptop",
    model: "glm-5.3",
    perms: ["files", "branch", "tests", "noMerge"],
  },
  research: {
    id: "research",
    species: "adelie",
    machine: "gpu",
    model: "qwen3.8-max",
    perms: ["files", "gpu", "noMerge"],
  },
  ops: {
    id: "ops",
    species: "king",
    machine: "cloud",
    model: "deepseek-v4-pro",
    perms: ["files", "drafts"],
  },
  verifier: {
    id: "verifier",
    species: "chinstrap",
    machine: "cloud",
    model: "minimax-m3",
    perms: ["readonly", "tests"],
  },
};

/** Who does each workbench's work. */
export const EXECUTOR_OF: Record<Workbench, ExecutorId> = {
  code: "dev",
  experiment: "research",
  document: "ops",
  ledger: "ops",
  outreach: "ops",
};

/** What a company can be set up to do, and the work each starts with. */
export const SCENARIOS = ["solo", "software", "research", "business"] as const;
export type Scenario = (typeof SCENARIOS)[number];
export const SCENARIO_WORK: Record<Scenario, readonly Workbench[]> = {
  solo: ["code", "experiment", "document", "outreach"],
  software: ["code", "document"],
  research: ["experiment", "document"],
  business: ["ledger", "document", "outreach"],
};

/** One step of a ticket's work, each with what it costs. */
export type Step =
  | { k: "work"; usd: number }
  | { k: "deliver"; usd: number }
  /** The verifier sends the work back with its `finding`-th finding. */
  | { k: "fail"; usd: number; finding: number }
  | { k: "pass"; usd: number }
  /** The work stops on the ticket's question. */
  | { k: "ask"; usd: number };

const work = (usd: number): Step => ({ k: "work", usd });
const deliver = (usd: number): Step => ({ k: "deliver", usd });
const fail = (finding: number, usd = 0.3): Step => ({ k: "fail", usd, finding });
const pass = (usd = 0.3): Step => ({ k: "pass", usd });
const ask: Step = { k: "ask", usd: 0.1 };

export type Source = "user" | "lead" | "github" | "message" | "patrol" | "review";

export type FixtureId =
  | "exportFix"
  | "evalSummary"
  | "releasePost"
  | "resellerTerms"
  | "replies"
  | "lintRule"
  | "syncDup"
  | "apiDocs"
  | "invoices"
  | "ciCache"
  | "guide"
  | "discount"
  | "installWin"
  | "proInquiry"
  | "pricing"
  | "tutorial"
  | "cheaperModel";

export interface Fixture {
  id: FixtureId;
  workbench: Workbench;
  source: Source;
  /** What the ticket may cost, in USD, before the server stops it. */
  budget: number;
  script: readonly Step[];
  /** How many of its steps it has taken in the sample week; null when it is not in the week. */
  week: number | null;
  /** The outward action accepting it sets going, if any. */
  outward?: OutwardAction;
  /** The ticket's question: its options, in order, and the one the executor recommends. */
  ask?: { options: readonly string[]; recommended: string };
  /** A change to how the company works, proposed by the lead; accepting it applies it. */
  change?: { member: ExecutorId; model?: ModelId };
  /** How the week settled it, when it is settled. */
  settled?: "done" | "dropped";
}

export const FIXTURES: Record<FixtureId, Fixture> = {
  exportFix: {
    id: "exportFix",
    workbench: "code",
    source: "github",
    budget: 5,
    script: [work(0.6), work(0.5), deliver(0.2), fail(0), work(0.4), deliver(0.2), pass()],
    week: 7,
    outward: "merge",
  },
  evalSummary: {
    id: "evalSummary",
    workbench: "experiment",
    source: "user",
    budget: 6,
    script: [work(0.8), work(1.1), ask, work(1.2), deliver(0.3), pass(0.4)],
    week: 3,
    ask: { options: ["subset", "full", "stop"], recommended: "subset" },
  },
  releasePost: {
    id: "releasePost",
    workbench: "document",
    source: "user",
    budget: 4,
    script: [work(0.5), deliver(0.2), fail(0), work(0.4), deliver(0.2), pass()],
    week: 6,
    outward: "publish",
  },
  resellerTerms: {
    id: "resellerTerms",
    workbench: "ledger",
    source: "message",
    budget: 5,
    script: [
      work(0.4),
      deliver(0.1),
      fail(0),
      work(0.3),
      deliver(0.1),
      fail(1),
      work(0.3),
      deliver(0.1),
      fail(2),
      work(0.3),
      deliver(0.1),
      pass(),
    ],
    week: 9,
    outward: "email",
  },
  replies: {
    id: "replies",
    workbench: "outreach",
    source: "patrol",
    budget: 2,
    script: [work(0.3), deliver(0.1), pass(0.2)],
    week: 3,
    outward: "reply",
  },
  lintRule: {
    id: "lintRule",
    workbench: "code",
    source: "review",
    budget: 1,
    script: [],
    week: 0,
    change: { member: "dev" },
  },
  syncDup: {
    id: "syncDup",
    workbench: "code",
    source: "github",
    budget: 5,
    script: [work(0.7), deliver(0.2), fail(0), work(0.5), deliver(0.2), pass()],
    week: 1,
    outward: "merge",
  },
  apiDocs: {
    id: "apiDocs",
    workbench: "document",
    source: "lead",
    budget: 3,
    script: [work(0.4), deliver(0.2), pass()],
    week: 2,
    outward: "publish",
  },
  invoices: {
    id: "invoices",
    workbench: "ledger",
    source: "patrol",
    budget: 2,
    script: [work(0.9), work(0.8), work(0.6), deliver(0.1), pass(0.2)],
    week: 1,
  },
  ciCache: {
    id: "ciCache",
    workbench: "code",
    source: "github",
    budget: 3,
    script: [work(0.5), deliver(0.1), fail(0), work(0.3), deliver(0.1), pass()],
    week: 6,
    outward: "merge",
    settled: "done",
  },
  guide: {
    id: "guide",
    workbench: "document",
    source: "user",
    budget: 3,
    script: [work(0.6), deliver(0.2), pass()],
    week: 3,
    outward: "publish",
    settled: "done",
  },
  discount: {
    id: "discount",
    workbench: "experiment",
    source: "lead",
    budget: 3,
    script: [work(0.5)],
    week: 1,
    settled: "dropped",
  },
  installWin: {
    id: "installWin",
    workbench: "code",
    source: "github",
    budget: 5,
    script: [work(0.5), deliver(0.2), pass()],
    week: null,
    outward: "merge",
  },
  proInquiry: {
    id: "proInquiry",
    workbench: "outreach",
    source: "message",
    budget: 2,
    script: [work(0.2), deliver(0.1), pass(0.1)],
    week: null,
    outward: "email",
  },
  pricing: {
    id: "pricing",
    workbench: "document",
    source: "user",
    budget: 4,
    script: [work(0.6), work(0.5), deliver(0.2), pass()],
    week: null,
    outward: "publish",
  },
  tutorial: {
    id: "tutorial",
    workbench: "document",
    source: "user",
    budget: 4,
    script: [work(0.5), deliver(0.2), fail(0), work(0.3), deliver(0.2), pass()],
    week: null,
    outward: "publish",
  },
  cheaperModel: {
    id: "cheaperModel",
    workbench: "ledger",
    source: "review",
    budget: 1,
    script: [],
    week: null,
    change: { member: "ops", model: "deepseek-v4-flash" },
  },
};

/** The sample week's tickets, in the order the company filed them. */
export const WEEK_TICKETS: readonly FixtureId[] = [
  "discount",
  "guide",
  "ciCache",
  "resellerTerms",
  "releasePost",
  "exportFix",
  "evalSummary",
  "replies",
  "apiDocs",
  "invoices",
  "syncDup",
  "lintRule",
];

/** The first ticket of each kind of work a new company files as it starts. */
export const STARTERS: Record<Workbench, FixtureId> = {
  code: "syncDup",
  experiment: "evalSummary",
  document: "releasePost",
  ledger: "invoices",
  outreach: "replies",
};

/** What arrives from outside while time passes: the pass it arrives on, and the ticket it files. */
export const EVENTS: readonly { pass: number; ticket: FixtureId }[] = [
  { pass: 1, ticket: "installWin" },
  { pass: 3, ticket: "proInquiry" },
];

/** The requests the lead's conversation suggests, each the ticket it files. */
export const REQUESTS: readonly FixtureId[] = ["pricing", "tutorial"];

/**
 * The experiment's curves: accuracy on the evaluation set as the candidate model's prompt is
 * tuned, against the model in use, per round.
 */
export const CURVES = {
  rounds: 6,
  current: [81.2, 81.2, 81.2, 81.2, 81.2, 81.2],
  candidate: [72.4, 76.9, 78.8, 79.6, 80.3, 80.6],
  longDocs: [61.0, 66.5, 70.2, 73.8, 76.1, 77.9],
  costPerThousand: { current: 1.84, candidate: 0.31 },
};

/** Fixed facts the welcome shows: what the lead found on the reader's machines. */
export const DETECTED = {
  machines: ["laptop", "gpu", "cloud"] as readonly MachineId[],
  models: MODELS.length,
  clis: ["Claude Code", "Codex"],
};
