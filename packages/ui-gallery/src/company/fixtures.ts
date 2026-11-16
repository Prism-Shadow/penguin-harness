/**
 * The sample company, a week in, keeps up PenguinHarness: its code, its docs, blog and community,
 * and the evaluation of new models, one employee to each part. The sample work it is staged with is
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

/**
 * Whose byline a ticket carries: one of the company's employees. The lead and the verifier are
 * every company's; any other is a role the lead drafted from the mission, by its id.
 */
export type Byline = string;

/**
 * The kind of work a role does, as the sample data knows it: code, writing (content, docs,
 * community) or research. A role is the reader's to name and describe; its part only says which
 * of the sample's tickets it takes. A role the reader adds has none, and takes none.
 */
export type Part = "engineer" | "writer" | "researcher";
export const PARTS: readonly Part[] = ["engineer", "writer", "researcher"];

/** The folder the company works in: the Project's workspace. */
export const WORKSPACE = "~/code/penguin-harness";

/**
 * Every employee is named after a penguin species: the Emperor leads, Chinstrap verifies, and the
 * roles the lead drafts take the others in this order. The species' names are the dictionaries'
 * `species`.
 */
export type Species =
  "emperor" | "chinstrap" | "gentoo" | "littleBlue" | "adelie" | "king" | "rockhopper" | "macaroni";
export const ROLE_SPECIES: readonly Species[] = [
  "gentoo",
  "littleBlue",
  "adelie",
  "king",
  "rockhopper",
  "macaroni",
];

/**
 * Each species' Agent id, which picks its avatar's colour; no two of the first five share one.
 */
export const AGENT_ID: Record<Species, string> = {
  emperor: "harness-lead",
  chinstrap: "org-verifier",
  gentoo: "org-engineer",
  littleBlue: "org-community",
  adelie: "org-study",
  king: "org-scout",
  rockhopper: "org-analyst",
  macaroni: "org-comms",
};

/**
 * The roles the lead can draft from a mission, and the kind of work each does. Their title,
 * duties and sources are the dictionaries' `drafts`; the words in a mission that call for each
 * are `setup.keywords`.
 */
export type DraftId =
  | "engineer"
  | "operations"
  | "editor"
  | "community"
  | "docs"
  | "digest"
  | "researcher"
  | "analyst"
  | "assistant";
export const DRAFT_PART: Record<DraftId, Part> = {
  engineer: "engineer",
  operations: "writer",
  editor: "writer",
  community: "writer",
  docs: "writer",
  digest: "writer",
  researcher: "researcher",
  analyst: "researcher",
  assistant: "writer",
};

/**
 * A role on the team besides the lead and the verifier: its id, its penguin, what it was drafted
 * as, and what the reader made of it. Its title and duties are the draft's unless the reader
 * wrote their own.
 */
export interface Role {
  id: Byline;
  species: Species;
  draft: DraftId | null;
  part: Part | null;
  title?: string;
  duties?: string;
}

/** The roles drafted, as the team: each takes the next species, and its draft's id. */
export const staffFrom = (drafts: readonly DraftId[]): Role[] =>
  drafts.map((draft, i) => ({
    id: draft,
    species: ROLE_SPECIES[i] ?? "macaroni",
    draft,
    part: DRAFT_PART[draft],
  }));

/** The sample week's team: one role for each kind of work. */
export const WEEK_STAFF: readonly Role[] = [
  { id: "engineer", species: "gentoo", draft: "engineer", part: "engineer" },
  { id: "writer", species: "littleBlue", draft: "operations", part: "writer" },
  { id: "researcher", species: "adelie", draft: "researcher", part: "researcher" },
];

/**
 * The broad directions the setup page offers a company, as the shipped company mode's example
 * missions are offered: a name, one line, and a whole mission to start from. Their words are
 * the dictionaries' `setup.templates`. Each drafts the fewest roles its mission needs.
 */
export const TEMPLATES = ["code", "content", "research"] as const;
export type TemplateId = (typeof TEMPLATES)[number];
export const TEMPLATE_DRAFTS: Record<TemplateId, readonly DraftId[]> = {
  code: ["engineer"],
  content: ["editor", "community"],
  research: ["researcher"],
};

/** The most roles the lead drafts from a mission of the reader's own. */
const MOST_DRAFTED = 3;

/**
 * The roles a mission the reader wrote calls for, as the lead would draft them: each role whose
 * words the mission uses, in the drafts' order, at most three; with none, one assistant.
 */
export function draftsFor(
  mission: string,
  keywords: Partial<Record<DraftId, readonly string[]>>,
): DraftId[] {
  const said = mission.toLowerCase();
  const drafts = (Object.keys(DRAFT_PART) as DraftId[]).filter((draft) =>
    (keywords[draft] ?? []).some((word) => said.includes(word.toLowerCase())),
  );
  return drafts.length === 0 ? ["assistant"] : drafts.slice(0, MOST_DRAFTED);
}

/** The task the lead proposes first for each part it staffs, beside its own survey. */
export const FIRST_TASK: Record<Part, FixtureId> = {
  engineer: "flaky",
  writer: "release",
  researcher: "evals",
};

/**
 * What a million Tokens cost in the sample, input, output and cache together, in US dollars. A
 * ticket's cost is its fixture's; its Tokens are read back from it at this price.
 */
export const USD_PER_MILLION_TOKENS = 3;

/**
 * One step a ticket's work takes. The building session notes progress, stops on its one question,
 * and delivers: straight to the person's review, or, on a ticket with a verifier, handed to a
 * verifying session, which either finds something and hands it back to the building session, or
 * passes it on to the person. A fixture's script names `deliver` only; the verifying steps are
 * written in when the ticket has a verifier (`scriptOf`).
 */
export type ScriptStep = "progress" | "ask" | "deliver" | "handoff" | "found" | "verified";

/**
 * Who does a sample ticket: the lead, the verifier, or whichever role on the team does that kind
 * of work.
 */
export type FixtureOwner = "lead" | "verifier" | Part;

export interface Fixture {
  kind: TicketKind;
  owner: FixtureOwner;
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
  /** The kind of work a skill is for: installed for the role that does it, once accepted. */
  installsOn?: Part;
  /** The lesson a skill absorbs: once it is installed, the lesson leaves the handbook's index. */
  merges?: HandbookDocId;
  /** Its delivery is verified before the person sees it, while the verifier is on the team. */
  verified?: boolean;
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
    verified: true,
    finds: true,
  },
  connection: {
    kind: "task",
    owner: "engineer",
    priority: "P1",
    script: ["progress", "progress", "deliver"],
    deliverable: "pull/126",
    cost: 3.1,
    verified: true,
  },
  flaky: {
    kind: "task",
    owner: "engineer",
    priority: "P1",
    script: ["progress", "deliver"],
    deliverable: "pull/129",
    cost: 1.8,
    verified: true,
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
    verified: true,
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
    verified: true,
  },
};

/** What the sample's retrospectives propose, by retrospective: the first, then the second. */
export const RETRO_PROPOSALS: readonly (readonly FixtureId[])[] = [["skill"], ["patrolScope"]];

/** The steps of a ticket the reader asked for in their own words. */
export const SAID_SCRIPT: readonly ScriptStep[] = ["progress", "deliver"];
