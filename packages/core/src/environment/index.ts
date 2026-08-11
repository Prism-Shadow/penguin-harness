/**
 * Environment module barrel — exports the environment interface implementation and builtin tool abstractions.
 */
export { Environment } from "./environment.js";
export type { BuiltinTool, ToolExecutionContext } from "./tools/types.js";
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
  MCP_TOOL_PREFIX,
  McpToolProvider,
  mcpToolName,
  resolveMCPServer,
  resolveMCPServers,
} from "./mcp/index.js";
export type {
  McpToolProviderOptions,
  ResolvedMCPServer,
  ResolvedMCPTransport,
  ResolveMCPServersResult,
} from "./mcp/index.js";
