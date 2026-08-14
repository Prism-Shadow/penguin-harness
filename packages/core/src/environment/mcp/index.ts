/**
 * MCP module barrel — config resolution and the tool provider bridging MCP Servers into
 * Environment.
 */
export {
  DEFAULT_MCP_CONNECT_TIMEOUT_MS,
  DEFAULT_MCP_PERMISSION,
  resolveMCPServer,
  resolveMCPServers,
} from "./config.js";
export type {
  MCPServerPermissionMode,
  ResolvedMCPServer,
  ResolvedMCPTransport,
  ResolveMCPServersResult,
} from "./config.js";
export {
  DEFAULT_TOOL_EXPOSURE_THRESHOLD_TOKENS,
  MCP_TOOL_PREFIX,
  McpToolProvider,
  TOOL_CALL_NAME,
  TOOL_SEARCH_NAME,
  mcpToolName,
  renderCallToolResult,
} from "./provider.js";
export type { McpToolProviderOptions } from "./provider.js";
