/**
 * Deleting one Agent everywhere moved to the agent domain library
 * (@prismshadow/penguin-library-agent/agent-deletion, services+http+cli restack S10) — every
 * dependency arrives as a plain shape, so this is a pure re-export keeping the server's import
 * paths stable.
 */
export * from "@prismshadow/penguin-library-agent/agent-deletion";
