/**
 * The system Agent's refusals moved to the agent domain library
 * (@prismshadow/penguin-library-agent/system-agent, services+http+cli restack S3) — they ask the
 * AgentConfig contract's predicate, which lives beside them there. This file re-exports them
 * unchanged for the server's own import paths.
 */
export {
  refuseReservedAgentId,
  refuseSystemAgentChange,
  refuseSystemAgentInstall,
  refuseSystemAgentSessions,
} from "@prismshadow/penguin-library-agent/system-agent";
