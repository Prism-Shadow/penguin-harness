/**
 * The export surface of `packages/core/src/environment`, executable.
 *
 * The built-in tool half of the module's contract (the seven `create*Tool` factories the barrel
 * exports, and the `*_NAME` constants the registry is keyed by) is one behaviour: a call whose
 * arguments do not fit the tool is **rejected by name** — a `fatal` tool result whose output is
 * `describeArgumentError`'s text, naming the faulted argument — and never accepted, never a
 * generic error and never a throw. Until this file, `input_command`'s `process_id` and
 * `input_subagent`'s `subagent_id` had no test at all: both factories are exercised elsewhere
 * (`exec-session.test.ts`, `background-execution.test.ts`) only through the paths *after* their
 * argument check, so a regression that dropped or loosened that check entered silently. The
 * other five carry the same assertion in their own files (read_file / edit_file / write_file in
 * `file-tools.test.ts`, exec_command in `environment.test.ts`, run_subagent in
 * `subagent.test.ts`); they are restated here as one table so the whole factory surface is
 * measured by one run, and so a new factory that forgets its argument check fails here.
 *
 * The definitions are the shipped ones (`defaultSystemConfig()`), not local stand-ins: the
 * parameter names in the fault sentence are the names the model is actually handed.
 */
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { BUILTIN_TOOL_FACTORIES } from "../src/environment/tools/registry.js";
import { READ_FILE_NAME, createReadFileTool } from "../src/environment/tools/read-file.js";
import { EDIT_FILE_NAME, createEditFileTool } from "../src/environment/tools/edit-file.js";
import { WRITE_FILE_NAME, createWriteFileTool } from "../src/environment/tools/write-file.js";
import { EXEC_COMMAND_NAME, createExecCommandTool } from "../src/environment/tools/exec-command.js";
import {
  INPUT_COMMAND_NAME,
  createInputCommandTool,
} from "../src/environment/tools/input-command.js";
import { SUBAGENT_NAME, createSubagentTool } from "../src/environment/tools/run-subagent.js";
import {
  INPUT_SUBAGENT_NAME,
  createInputSubagentTool,
} from "../src/environment/tools/input-subagent.js";
import { CommandSessionManager } from "../src/environment/tools/command/index.js";
import { SubagentSessionManager } from "../src/environment/tools/subagent/index.js";
import type { BuiltinTool, ToolResult } from "../src/environment/tools/types.js";
import type {
  EnvironmentServices,
  SubagentHandle,
  SubagentRunner,
  ToolDefinitionConfig,
} from "../src/interfaces/index.js";
import { defaultSystemConfig } from "../src/state/default-config.js";

/** The shipped entry for a built-in tool — the schema the model was actually handed. */
function shippedDefinition(name: string): ToolDefinitionConfig {
  const entry = defaultSystemConfig().tools?.builtin?.find((t) => t.name === name);
  expect(entry, `the shipped tool config has no "${name}" entry`).toBeDefined();
  return entry!;
}

/**
 * A services bundle for one tool: the real managers (the argument check sits behind them, so a
 * rejected call proves it got past the "unavailable" branch) and a runner that records any
 * spawn — a call rejected for its arguments must never reach it.
 */
function fixture(): { services: EnvironmentServices; spawned: string[] } {
  const spawned: string[] = [];
  const subagentRunner: SubagentRunner = {
    async spawn(): Promise<SubagentHandle> {
      spawned.push("spawn");
      throw new Error("the call must be rejected before a child Session is created");
    },
  };
  return {
    spawned,
    services: {
      commandSessions: new CommandSessionManager(),
      subagentSessions: new SubagentSessionManager(),
      subagentRunner,
    },
  };
}

/** Runs one tool execution: the concatenated output deltas and the generator's return value. */
async function run(
  tool: BuiltinTool,
  args: Record<string, unknown>,
): Promise<{ text: string; result: ToolResult | void }> {
  const gen = tool.execute(args, { workspaceDir: tmpdir(), toolCallId: "call_env_exports" });
  let text = "";
  for (;;) {
    const res = await gen.next();
    if (res.done) return { text, result: res.value };
    text += (res.value.payload as { output?: string }).output ?? "";
  }
}

interface RejectionCase {
  /** The tool's name: the `*_NAME` constant, the shipped config's name and the registry key. */
  name: string;
  build: (definition: ToolDefinitionConfig, services?: EnvironmentServices) => BuiltinTool;
  /** A call with one argument malformed (missing, empty or of the wrong type). */
  args: Record<string, unknown>;
  /** The fault sentence the output must carry: the argument, named. */
  fault: string;
}

const REJECTION_CASES: RejectionCase[] = [
  {
    name: READ_FILE_NAME,
    build: createReadFileTool,
    args: {},
    fault: 'read_file was not run: required argument "file_path" is missing.',
  },
  {
    name: EDIT_FILE_NAME,
    build: createEditFileTool,
    args: { old_string: "a", new_string: "b" },
    fault: 'edit_file was not run: required argument "file_path" is missing.',
  },
  {
    name: WRITE_FILE_NAME,
    build: createWriteFileTool,
    args: { file_path: "f.txt" },
    fault: 'write_file was not run: required argument "content" is missing.',
  },
  {
    name: EXEC_COMMAND_NAME,
    build: createExecCommandTool,
    args: { description: "list the files" },
    fault: 'exec_command was not run: required argument "cmd" is missing.',
  },
  {
    name: INPUT_COMMAND_NAME,
    build: createInputCommandTool,
    args: { description: "poll the session" },
    fault: 'input_command was not run: required argument "process_id" is missing.',
  },
  {
    name: SUBAGENT_NAME,
    build: createSubagentTool,
    args: { agent_id: "someone" },
    fault: 'run_subagent was not run: required argument "prompt" is missing.',
  },
  {
    name: INPUT_SUBAGENT_NAME,
    build: createInputSubagentTool,
    args: { description: "poll the subagent" },
    fault: 'input_subagent was not run: required argument "subagent_id" is missing.',
  },
];

describe("built-in tool factories — a malformed call is rejected by name", () => {
  it("names the faulted argument, ends fatal, and never reaches a runner", async () => {
    for (const c of REJECTION_CASES) {
      const { services, spawned } = fixture();
      const tool = c.build(shippedDefinition(c.name), services);
      expect(tool.name, `${c.name}: the factory names its own tool`).toBe(c.name);
      const { text, result } = await run(tool, c.args);
      expect(result?.stopReason, `${c.name}: the rejection is fatal`).toBe("fatal");
      expect(text, `${c.name}: the fault sentence names the argument`).toContain(c.fault);
      expect(spawned, `${c.name}: nothing was spawned`).toEqual([]);
    }
  });

  it("carries the whole explanation: the names received, the parameters, and a correct call", async () => {
    const { services } = fixture();
    const tool = createInputCommandTool(shippedDefinition(INPUT_COMMAND_NAME), services);
    const { text, result } = await run(tool, { description: "poll it", processId: "proc-1" });
    expect(result?.stopReason).toBe("fatal");
    const lines = text.split("\n");
    expect(lines[0]).toBe('input_command was not run: required argument "process_id" is missing.');
    // The received names, with the misnamed one called out — the line a typo is caught by.
    expect(lines[1]).toBe(
      "Arguments received: description, processId. " +
        "Not a parameter of input_command: processId.",
    );
    expect(lines).toContain("Parameters of input_command:");
    expect(lines).toContain(
      "- process_id (string, required): The process_id returned by exec_command for the running command session.",
    );
    expect(lines[lines.length - 1]).toBe(
      'Call input_command again with "process_id" provided, as one JSON object using exactly ' +
        'these parameter names, e.g. {"description": "<description>", "process_id": "<process_id>"}.',
    );
  });
});

describe("input_command — the process_id argument", () => {
  /** The factory's argument check, which no test covered before: empty and wrong-type included. */
  it("names process_id when it is absent, empty, or not a string", async () => {
    const { services, spawned } = fixture();
    const tool = createInputCommandTool(shippedDefinition(INPUT_COMMAND_NAME), services);

    const absent = await run(tool, { description: "poll it" });
    expect(absent.result?.stopReason).toBe("fatal");
    expect(absent.text).toContain(
      'input_command was not run: required argument "process_id" is missing.',
    );

    const empty = await run(tool, { description: "poll it", process_id: "" });
    expect(empty.result?.stopReason).toBe("fatal");
    expect(empty.text).toContain(
      'input_command was not run: required argument "process_id" is empty.',
    );

    const wrongType = await run(tool, { description: "poll it", process_id: 42 });
    expect(wrongType.result?.stopReason).toBe("fatal");
    expect(wrongType.text).toContain(
      'input_command was not run: argument "process_id" must be a string, but a number was received.',
    );

    expect(spawned).toEqual([]);
  });
});

describe("input_subagent — the subagent_id argument", () => {
  /** The factory's argument check, uncovered before for the same reason as input_command's. */
  it("names subagent_id when it is absent or empty", async () => {
    const { services, spawned } = fixture();
    const tool = createInputSubagentTool(shippedDefinition(INPUT_SUBAGENT_NAME), services);

    const absent = await run(tool, { description: "poll it" });
    expect(absent.result?.stopReason).toBe("fatal");
    expect(absent.text).toContain(
      'input_subagent was not run: required argument "subagent_id" is missing.',
    );

    const empty = await run(tool, { description: "poll it", subagent_id: "" });
    expect(empty.result?.stopReason).toBe("fatal");
    expect(empty.text).toContain(
      'input_subagent was not run: required argument "subagent_id" is empty.',
    );

    const wrongType = await run(tool, { description: "poll it", subagent_id: 7 });
    expect(wrongType.result?.stopReason).toBe("fatal");
    expect(wrongType.text).toContain(
      'input_subagent was not run: argument "subagent_id" must be a string, but a number was received.',
    );

    expect(spawned).toEqual([]);
  });
});

describe("the built-in tool surface", () => {
  it("registers exactly the seven exported factories, each under its own name constant", () => {
    const expected = REJECTION_CASES.map((c) => c.name).sort();
    // A new built-in tool is a new entry here — add its case above, so its argument check is
    // measured by this file too.
    expect(Object.keys(BUILTIN_TOOL_FACTORIES).sort()).toEqual(expected);
    for (const c of REJECTION_CASES) {
      const factory = BUILTIN_TOOL_FACTORIES[c.name];
      expect(factory, `${c.name} is registered`).toBe(c.build);
      const definition = shippedDefinition(c.name);
      expect(factory!(definition).definition).toEqual(definition);
    }
  });
});
