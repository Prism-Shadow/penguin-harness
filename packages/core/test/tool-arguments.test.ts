import { describe, expect, it } from "vitest";
import { describeArgumentError, stringArgument } from "../src/environment/tools/tool-arguments.js";
import type { ToolDefinitionConfig } from "../src/interfaces/index.js";
import { defaultSystemConfig } from "../src/state/default-config.js";

/** A schema shaped like the shipped exec_command entry (see state/default-config.ts). */
const execCommand: ToolDefinitionConfig = {
  name: "exec_command",
  description: "Run a shell command.",
  parameters: {
    type: "object",
    properties: {
      description: { type: "string", description: "One sentence shown to the user." },
      cmd: { type: "string", description: "Shell command to execute." },
      workdir: { type: "string", description: "Working directory for the command." },
      yield_time_ms: { type: "number", description: "How long to wait before yielding." },
      run_in_background: { type: "boolean", description: "Return a process_id immediately." },
    },
    required: ["description", "cmd"],
  },
};

const readFile: ToolDefinitionConfig = {
  name: "read_file",
  description: "Read a file.",
  parameters: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Path to read." },
      offset: { type: "number", description: "First line to show." },
      limit: { type: "number", description: "Maximum lines to show." },
    },
    required: ["file_path"],
  },
};

const aliases = { cmd: ["command"] };

describe("stringArgument", () => {
  it("reads the first listed name that carries a string, in list order", () => {
    expect(stringArgument({ cmd: "ls", command: "rm" }, ["cmd", "command"])).toEqual({
      name: "cmd",
      value: "ls",
    });
    expect(stringArgument({ command: "ls" }, ["cmd", "command"])).toEqual({
      name: "command",
      value: "ls",
    });
  });

  it("skips a listed name whose value is not a string, and is undefined when none fits", () => {
    expect(stringArgument({ cmd: 42, command: "ls" }, ["cmd", "command"])).toEqual({
      name: "command",
      value: "ls",
    });
    expect(stringArgument({ cmd: 42 }, ["cmd", "command"])).toBeUndefined();
    expect(stringArgument({}, ["cmd"])).toBeUndefined();
  });
});

describe("describeArgumentError", () => {
  it("names the missing argument, the names received, the unknown ones, every parameter, and a correct call", () => {
    const text = describeArgumentError(
      execCommand,
      { description: "list files", comand: "ls" },
      { argument: "cmd", kind: "missing" },
    );
    const lines = text.split("\n");
    expect(lines[0]).toBe('exec_command was not run: required argument "cmd" is missing.');
    expect(lines[1]).toBe(
      "Arguments received: description, comand. Not a parameter of exec_command: comand.",
    );
    expect(lines[2]).toBe("Parameters of exec_command:");
    expect(lines).toContain("- description (string, required): One sentence shown to the user.");
    expect(lines).toContain("- cmd (string, required): Shell command to execute.");
    expect(lines).toContain("- workdir (string, optional): Working directory for the command.");
    expect(lines).toContain(
      "- yield_time_ms (number, optional): How long to wait before yielding.",
    );
    expect(lines).toContain(
      "- run_in_background (boolean, optional): Return a process_id immediately.",
    );
    expect(lines[lines.length - 1]).toBe(
      'Call exec_command again with "cmd" provided, as one JSON object using exactly these ' +
        'parameter names, e.g. {"description": "<description>", "cmd": "<cmd>"}.',
    );
  });

  it("pluralizes the unknown names and says so when nothing was received", () => {
    expect(
      describeArgumentError(execCommand, { a: 1, b: 2 }, { argument: "cmd", kind: "missing" }),
    ).toContain("Arguments received: a, b. Not parameters of exec_command: a, b.");
    expect(describeArgumentError(execCommand, {}, { argument: "cmd", kind: "missing" })).toContain(
      "Arguments received: none.",
    );
  });

  it("treats an alias as the parameter it stands for, and shows it beside the parameter", () => {
    const text = describeArgumentError(
      execCommand,
      { description: "x", command: 42 },
      { argument: "cmd", kind: "missing" },
      { aliases },
    );
    expect(text).toContain(
      'exec_command was not run: argument "cmd" (received as "command") must be a string, but a number was received.',
    );
    expect(text).toContain("Arguments received: description, command.\n");
    expect(text).not.toContain("Not a parameter");
    expect(text).toContain('- cmd (string, required; also accepted as "command"): Shell command');
  });

  it("distinguishes an empty value and a wrong type from an absent argument", () => {
    expect(
      describeArgumentError(execCommand, { cmd: "" }, { argument: "cmd", kind: "missing" }),
    ).toContain('required argument "cmd" is empty.');
    expect(
      describeArgumentError(execCommand, { cmd: null }, { argument: "cmd", kind: "missing" }),
    ).toContain('argument "cmd" must be a string, but null was received.');
    expect(
      describeArgumentError(execCommand, { cmd: ["ls"] }, { argument: "cmd", kind: "missing" }),
    ).toContain('argument "cmd" must be a string, but an array was received.');
    expect(
      describeArgumentError(
        execCommand,
        { yield_time_ms: "soon" },
        { argument: "yield_time_ms", kind: "missing" },
      ),
    ).toContain('argument "yield_time_ms" must be a number, but a string was received.');
    // A schema property that declares no type (a hand-edited config) has nothing to hold the value against.
    expect(
      describeArgumentError(
        {
          ...execCommand,
          parameters: { type: "object", properties: { cmd: {} }, required: ["cmd"] },
        },
        { cmd: 42 },
        { argument: "cmd", kind: "missing" },
      ),
    ).toContain('argument "cmd" cannot be used as received (a number).');
  });

  it("carries an invalid argument's detail and puts that argument in the example call", () => {
    const text = describeArgumentError(
      readFile,
      { file_path: "a.txt", offset: "abc" },
      { argument: "offset", kind: "invalid", detail: 'expected a number (got "abc")' },
    );
    expect(text).toContain(
      'read_file was not run: argument "offset" is invalid: expected a number (got "abc").',
    );
    expect(text).toContain("Arguments received: file_path, offset.\n");
    expect(text.split("\n").pop()).toBe(
      'Call read_file again with a valid "offset", as one JSON object using exactly these ' +
        'parameter names, e.g. {"file_path": "<file_path>", "offset": 0}.',
    );
  });

  it("appends the hint to the fault sentence", () => {
    const text = describeArgumentError(
      { ...readFile, name: "edit_file" },
      { file_path: "f", old_string: "" },
      { argument: "old_string", kind: "missing" },
      { hint: "To create a file, use write_file." },
    );
    expect(text.split("\n")[0]).toBe(
      'edit_file was not run: required argument "old_string" is empty. To create a file, use write_file.',
    );
  });

  it("still explains a definition that declares no parameters", () => {
    const text = describeArgumentError(
      { name: "read_file", description: "Read a file." },
      { path: "a.txt" },
      { argument: "file_path", kind: "missing" },
    );
    expect(text).toBe(
      [
        'read_file was not run: required argument "file_path" is missing.',
        "Arguments received: path.",
        'Call read_file again with "file_path" provided, as one JSON object using the tool\'s parameter names.',
      ].join("\n"),
    );
  });

  it("keeps the tool and argument names inside the last 500 characters, the tail the error ledger records", () => {
    // The shipped entry: its parameter descriptions alone run past the ledger's message cap.
    const shipped = defaultSystemConfig().tools?.builtin?.find((t) => t.name === "exec_command");
    expect(shipped).toBeDefined();
    const text = describeArgumentError(shipped!, {}, { argument: "cmd", kind: "missing" });
    expect(text.length).toBeGreaterThan(500);
    const tail = text.slice(-500);
    expect(tail).toContain("exec_command");
    expect(tail).toContain('"cmd"');
  });
});
