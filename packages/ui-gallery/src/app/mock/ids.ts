/**
 * The demo store's identifiers, in one place: the surfaces' routes name them, the fixtures
 * build the rows they name, and a test holds the two together. Ids follow the server's own
 * rules (a Project or Agent id is `^[a-z][a-z0-9_-]+$`; a session id is opaque).
 */
export const IDS = {
  project: "demo",
  users: { admin: "admin", member: "alice" },
  agents: { docs: "docs-expert", notes: "release-notes" },
  sessions: {
    /** A finished Task: thinking, three tools, a diff, a Markdown answer. */
    done: "s-hooks-index",
    /** A Task mid-run: a command executing, its output still to come. */
    runningTool: "s-link-check",
    /** A Task mid-run: the model thinking, the text still streaming in. */
    thinking: "s-release-plan",
    /** A Task waiting on a human: a command that needs approval. */
    approval: "s-publish",
    /** Older conversations that fill the list. */
    older: ["s-sync-corpus", "s-onboarding", "s-benchmarks", "s-mcp-setup"],
    /** One row per folder: archived, a scheduled run, a subagent, an evaluation. */
    archived: "s-archived-migration",
    schedule: "s-nightly-sync",
    subagent: "s-sub-linkcheck",
    benchmark: "s-eval-run",
    /** The release-notes Agent's own. */
    notes: ["s-notes-0213", "s-notes-0212"],
  },
  benchmarks: { docs: "docs-qa-v1", draft: "release-notes-draft" },
  plugins: {
    /** A library plugin the detail page opens on. */
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
  IDS.sessions.approval,
  ...IDS.sessions.older,
  IDS.sessions.archived,
  IDS.sessions.schedule,
  IDS.sessions.subagent,
  IDS.sessions.benchmark,
  ...IDS.sessions.notes,
];
