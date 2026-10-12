/**
 * The demo store's identifiers, in one place: the surfaces' routes name them, the fixtures
 * build the rows they name, and a test holds the two together. Ids follow the server's own
 * rules (a Project or Agent id is `^[a-z][a-z0-9_-]+$`; a session id is opaque).
 */
export const IDS = {
  project: "demo",
  users: { admin: "admin", member: "alice" },
  /** The two Agents of the demo, and the Project's built-in one, which optimizes the docs Agent. */
  agents: { docs: "docs-expert", notes: "release-notes", general: "default_agent" },
  sessions: {
    /** A finished Task: thinking, three tools, a diff, a Markdown answer. */
    done: "s-hooks-index",
    /** A Task mid-run: a command executing, its output still to come. */
    runningTool: "s-link-check",
    /** A Task mid-run: the model thinking, the text still streaming in. */
    thinking: "s-release-plan",
    /** A Task mid-run: the reply streaming in, played on a loop while the Session is watched. */
    streaming: "s-citation-guard",
    /** A Task waiting on a human: a command that needs approval. */
    approval: "s-publish",
    /** Older conversations that fill the list. */
    older: ["s-sync-corpus", "s-onboarding", "s-benchmarks", "s-mcp-setup"],
    /**
     * The rows the sidebar does not list: archived by hand, a scheduled run and an evaluation
     * (archived until kept), and a subagent (its parent's Agent panel opens it).
     */
    archived: "s-archived-migration",
    schedule: "s-nightly-sync",
    subagent: "s-sub-linkcheck",
    benchmark: "s-eval-run",
    /** A `penguin run` Session the user unarchived: listed among the conversations, with its glyph. */
    kept: "s-kept-run",
    /** Every row the harness writes into a conversation; the oldest in the list. */
    harness: "s-harness-rows",
    /** The release-notes Agent's own. */
    notes: ["s-notes-0213", "s-notes-0212"],
    /** The release-notes Agent's desk, opened by an organization's scheduler; never listed. */
    orgDesk: "s-org-digest",
    /** The General Agent's self-evolution round on the docs Agent: evaluators, scores, an edit, a re-evaluation. */
    optimize: "s-optimize-docs",
    /** The round's four evaluator subagents, one per case, in case order; never listed. */
    evaluators: ["s-eval-hooks", "s-eval-mcp", "s-eval-memory", "s-eval-citations"],
    /** The Test Sessions the evaluators ran the docs Agent in (`penguin run`): archived until kept. */
    tests: ["s-test-hooks", "s-test-mcp", "s-test-memory", "s-test-citations"],
  },
  /** A Benchmark the docs agent wrote, one still being built, and a built-in one. */
  benchmarks: {
    docs: "docs-qa-v1",
    draft: "release-notes-draft",
    builtin: "penguinharness-benchmark-sec-e",
  },
  plugins: {
    /** A library plugin one demo Agent is behind on, so its card shows an update. */
    registry: "claude-code-expert",
  },
  machine: "local",
  workspace: "/home/demo/projects/docs-expert",
} as const;

/** Every session id the store seeds, for the tests that walk them. */
export const ALL_SESSION_IDS: readonly string[] = [
  IDS.sessions.done,
  IDS.sessions.runningTool,
  IDS.sessions.thinking,
  IDS.sessions.streaming,
  IDS.sessions.approval,
  ...IDS.sessions.older,
  IDS.sessions.archived,
  IDS.sessions.schedule,
  IDS.sessions.subagent,
  IDS.sessions.benchmark,
  IDS.sessions.kept,
  IDS.sessions.harness,
  ...IDS.sessions.notes,
  IDS.sessions.orgDesk,
  IDS.sessions.optimize,
  ...IDS.sessions.evaluators,
  ...IDS.sessions.tests,
];
