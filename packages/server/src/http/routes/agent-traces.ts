/**
 * Moved to the trace library package (@prismshadow/penguin-library-trace/routes, services+http+cli
 * restack S9e — the factory and its deps shapes; its assembly is services/agent-routes.ts).
 * Re-exported so the server's existing importers keep their spelling.
 */
export {
  agentTracesRoutes,
  type AgentTracesRouteDeps,
  type TraceAccess,
  type TraceAgentConfig,
} from "@prismshadow/penguin-library-trace/routes";
