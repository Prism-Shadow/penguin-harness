/**
 * Public surface of the coding-agents kernel: an Agent Client Protocol (ACP) client that
 * drives external coding agents as subprocesses. The SDK's types stop here — hosts consume
 * the neutral vocabulary in types.ts.
 */
export {
  AcpConnection,
  type AcpClientInfo,
  type AcpConnectionHandlers,
  type SpawnProcess,
} from "./connection.js";
export {
  CodingAgentManager,
  type AgentSessionView,
  type CodingAgentManagerOptions,
} from "./manager.js";
export { discoverAgents, type AgentDiscoveryCandidate, type AgentLaunch } from "./discovery.js";
export { resolveCommandPath } from "./resolve.js";
export { sandboxedAgentEnv } from "./env.js";
export {
  AcpAgentError,
  parseDefinition,
  type AgentModes,
  type AgentPermissionOption,
  type AgentPermissionOutcome,
  type AgentPermissionRequest,
  type AgentServerDefinition,
  type AgentSessionConfigOption,
  type AgentSessionEvent,
  type AgentStopReason,
  type AgentToolCall,
  type AgentToolKind,
  type AgentToolLocation,
  type AgentToolStatus,
} from "./types.js";
