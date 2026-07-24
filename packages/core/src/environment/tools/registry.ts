/**
 * Built-in tool registry —— maps tool names to BuiltinTool factories.
 *
 * Environment uses this table to assemble entries from ToolConfig into BuiltinTool instances:
 * a tool is only assembled if its name is in the table (i.e. a supported built-in tool); the
 * description/parameters/permission/maxOutputLength from config are injected into the tool's
 * `definition` by each factory, and the runtime tool name follows the config entry's name.
 * When adding a new built-in tool, just register one factory entry here — no changes to
 * Environment needed.
 *
 * Docs: packages/docs/content/tools.{zh,en}.md (site path /docs/tools) documents every
 * built-in tool and the approval flow — keep the page in sync when this table changes.
 */
import type { EnvironmentServices, ToolDefinitionConfig } from "../../interfaces.js";
import type { BuiltinTool } from "./types.js";
import { EXEC_COMMAND_NAME, RUN_COMMAND_NAME, createRunCommandTool } from "./run-command.js";
import { INPUT_COMMAND_NAME, createInputCommandTool } from "./input-command.js";
import { READ_FILE_NAME, createReadFileTool } from "./read-file.js";
import { EDIT_FILE_NAME, createEditFileTool } from "./edit-file.js";
import { WRITE_FILE_NAME, createWriteFileTool } from "./write-file.js";
import { SUBAGENT_NAME, createSubagentTool } from "./run-subagent.js";
import { INPUT_SUBAGENT_NAME, createInputSubagentTool } from "./input-subagent.js";
import { READ_IMAGE_NAME, createReadImageTool } from "./read-image.js";
import { DESCRIBE_IMAGE_NAME, createDescribeImageTool } from "./describe-image.js";

/**
 * A factory that constructs a BuiltinTool instance from a tool config entry; optionally
 * receives runtime services injected by Environment.
 * Most tools ignore `services`; only a few (e.g. `run_subagent`) use it.
 */
export type BuiltinToolFactory = (
  definition: ToolDefinitionConfig,
  services?: EnvironmentServices,
) => BuiltinTool;

/** Tool name -> factory. */
export const BUILTIN_TOOL_FACTORIES: Record<string, BuiltinToolFactory> = {
  [RUN_COMMAND_NAME]: createRunCommandTool,
  // Legacy alias: an on-disk system_config.yaml is loaded verbatim (no default-merge), so
  // agents created before the exec_command -> run_command rename still list "exec_command".
  // Both names map to the same factory, and the assembled tool takes its runtime name from
  // the config entry — old agents and old traces keep working unchanged.
  [EXEC_COMMAND_NAME]: createRunCommandTool,
  [INPUT_COMMAND_NAME]: createInputCommandTool,
  [READ_FILE_NAME]: createReadFileTool,
  [EDIT_FILE_NAME]: createEditFileTool,
  [WRITE_FILE_NAME]: createWriteFileTool,
  [SUBAGENT_NAME]: createSubagentTool,
  [INPUT_SUBAGENT_NAME]: createInputSubagentTool,
  [READ_IMAGE_NAME]: createReadImageTool,
  // describe_image: the text-only-model variant of read_image (hands the image to the
  // configured vision model for description, returns text).
  // Which tool is used for which model class is declared by the config entry's forModel
  // annotation; before assembly, selectBuiltinToolsForModel has already filtered out entries
  // that don't apply to the session's model.
  [DESCRIBE_IMAGE_NAME]: (definition, services) =>
    createDescribeImageTool(definition, services?.visionDescriber ?? { modelId: null }),
};
