/**
 * Environment module barrel — exports the environment interface implementation and builtin tool abstractions.
 */
export { Environment } from "./environment.js";
export type { BuiltinTool, ToolExecutionContext } from "./tools/types.js";
export { localFsPort } from "./tools/fs-port.js";
export type { FsDirent, FsFetchResult, FsPort, FsStat } from "./tools/fs-port.js";
export { BUILTIN_TOOL_FACTORIES } from "./tools/registry.js";
export type { BuiltinToolFactory } from "./tools/registry.js";
export { createReadFileTool, READ_FILE_NAME } from "./tools/read-file.js";
export { createEditFileTool, EDIT_FILE_NAME } from "./tools/edit-file.js";
export { createWriteFileTool, WRITE_FILE_NAME } from "./tools/write-file.js";
export { createExecCommandTool, EXEC_COMMAND_NAME } from "./tools/exec-command.js";
export { createInputCommandTool, INPUT_COMMAND_NAME } from "./tools/input-command.js";
export { createSubagentTool, SUBAGENT_NAME } from "./tools/run-subagent.js";
export { createInputSubagentTool, INPUT_SUBAGENT_NAME } from "./tools/input-subagent.js";
export { CommandSessionManager, ManagedSession } from "./tools/command/index.js";
export type { ProcessExit, SpawnOptions } from "./tools/command/index.js";
export { SubagentSessionManager, ManagedSubagentSession } from "./tools/subagent/index.js";
export {
  DEFAULT_MCP_CONNECT_TIMEOUT_MS,
  DEFAULT_MCP_PERMISSION,
  MCP_SERVER_NAME_PATTERN,
  MCP_TOOL_PREFIX,
  McpToolProvider,
  PLUGIN_ROOT_REF,
  VAULT_REF_PATTERN,
  collectVaultRefs,
  mcpSkipMessage,
  mcpToolName,
  needsSignIn,
  readsVaultReferences,
  resolveMCPServer,
  resolveMCPServers,
  substituteVaultRefs,
} from "./mcp/index.js";
export type {
  MCPServerPermissionMode,
  MCPServerSkip,
  McpToolProviderOptions,
  ResolvedMCPServer,
  ResolvedMCPTransport,
  ResolveMCPServersResult,
  SkippedMCPServer,
} from "./mcp/index.js";
