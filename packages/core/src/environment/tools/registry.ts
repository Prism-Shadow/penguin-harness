/**
 * Built-in tool registry —— maps tool names to BuiltinTool factories.
 *
 * Environment uses this table to assemble entries from ToolConfig into BuiltinTool instances:
 * a tool is only assembled if its name is in the table (i.e. a supported built-in tool); the
 * description/parameters/permission/maxOutputLength from config are injected into the tool's
 * `definition` by each factory, and the runtime tool name follows the config entry's name.
 * When adding a new built-in tool, just register one factory entry here — no changes to
 * Environment needed. A stored entry whose name has no factory (a tool removed since the
 * config was written, e.g. `kill_command`, `read_image`, `describe_image`) is skipped:
 * neither listed to the model nor executable, and a call by that name gets the standard
 * unknown-tool reply.
 *
 * Docs: packages/docs/content/tools.{zh,en}.md (site path /docs/tools) documents every
 * built-in tool and the approval flow — keep the page in sync when this table changes.
 */
import type { EnvironmentServices, ToolDefinitionConfig } from "../../interfaces/index.js";
import type { BuiltinTool } from "./types.js";
import { READ_FILE_NAME, createReadFileTool } from "./read-file.js";
import { EDIT_FILE_NAME, createEditFileTool } from "./edit-file.js";
import { WRITE_FILE_NAME, createWriteFileTool } from "./write-file.js";
import { EXEC_COMMAND_NAME, createExecCommandTool } from "./exec-command.js";
import { INPUT_COMMAND_NAME, createInputCommandTool } from "./input-command.js";
import { SUBAGENT_NAME, createSubagentTool } from "./run-subagent.js";
import { INPUT_SUBAGENT_NAME, createInputSubagentTool } from "./input-subagent.js";

/**
 * A factory that constructs a BuiltinTool instance from a tool config entry; optionally
 * receives runtime services injected by Environment.
 * Most tools ignore `services`; a few use it (`run_subagent` for the runner, `read_file` for
 * the vision describer that tells it the session model cannot view images).
 */
export type BuiltinToolFactory = (
  definition: ToolDefinitionConfig,
  services?: EnvironmentServices,
) => BuiltinTool;

/** Tool name -> factory. */
export const BUILTIN_TOOL_FACTORIES: Record<string, BuiltinToolFactory> = {
  [READ_FILE_NAME]: createReadFileTool,
  [EDIT_FILE_NAME]: createEditFileTool,
  [WRITE_FILE_NAME]: createWriteFileTool,
  [EXEC_COMMAND_NAME]: createExecCommandTool,
  [INPUT_COMMAND_NAME]: createInputCommandTool,
  [SUBAGENT_NAME]: createSubagentTool,
  [INPUT_SUBAGENT_NAME]: createInputSubagentTool,
};
