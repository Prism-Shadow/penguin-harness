/**
 * The one-time employee-author migration moved to the agent domain library
 * (@prismshadow/penguin-library-agent/agent-author-migration, services+http+cli restack S10) —
 * this re-export keeps the server's import paths stable.
 */
export * from "@prismshadow/penguin-library-agent/agent-author-migration";
