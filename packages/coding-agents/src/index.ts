/**
 * Public surface of the coding-agents kernel: an Agent Client Protocol (ACP) client that
 * drives external coding agents as subprocesses. The SDK's types stop here — hosts consume
 * the neutral vocabulary in types.ts.
 */
export {
  AcpConnection,
  spawnTarget,
  type AcpClientInfo,
  type AcpConnectionHandlers,
  type SpawnProcess,
} from "./connection.js";
export {
  CodingAgentManager,
  type AgentSessionOptions,
  type AgentSessionView,
  type ProtectedRoot,
  type AgentTurnOutcome,
  type CodingAgentManagerOptions,
} from "./manager.js";
export {
  discoverAgents,
  type AgentAuthStatus,
  type AgentDiscoveryCandidate,
  type AgentLaunch,
} from "./discovery.js";
export { probeAgentOptions, type AgentProbeRequest } from "./probe.js";
export { killProcessTree } from "./process-tree.js";
export { protectedPathIn, type GuardedToolCall } from "./path-guard.js";
export { resolveCommandPath } from "./resolve.js";
export { isReservedEnvKey, sandboxedAgentEnv, validateAgentEnvEntry } from "./env.js";
export {
  AcpAgentError,
  parseDefinition,
  type AgentModes,
  type AgentPermissionOption,
  type AgentPermissionOutcome,
  type AgentPermissionRequest,
  type AgentResumeSupport,
  type AgentServerDefinition,
  type AgentSessionConfigOption,
  type AgentSessionEvent,
  type AgentStopReason,
  type AgentToolCall,
  type AgentToolKind,
  type AgentToolLocation,
  type AgentToolStatus,
  type AgentTurnUsage,
} from "./types.js";
