/**
 * MCP module barrel — config resolution and the tool provider bridging MCP Servers into
 * Environment.
 */
export {
  DEFAULT_MCP_CONNECT_TIMEOUT_MS,
  DEFAULT_MCP_PERMISSION,
  MCP_SERVER_NAME_PATTERN,
  PLUGIN_ROOT_REF,
  VAULT_REF_PATTERN,
  collectVaultRefs,
  mapConfigStrings,
  mcpSkipMessage,
  needsSignIn,
  readsVaultReferences,
  resolveMCPServer,
  resolveMCPServers,
  substituteVaultRefs,
} from "./config.js";
export type {
  MCPServerPermissionMode,
  MCPServerSkip,
  ResolvedMCPServer,
  ResolvedMCPTransport,
  ResolveMCPServersResult,
  SkippedMCPServer,
} from "./config.js";
export { MCP_TOOL_PREFIX, McpToolProvider, mcpToolName, renderCallToolResult } from "./provider.js";
export type { McpToolProviderOptions } from "./provider.js";
