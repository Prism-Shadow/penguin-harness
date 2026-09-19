/**
 * tool-alias.ts unit tests: resolving a tool call's display name.
 *
 * The table covers the built-in tools and nothing else — an MCP tool and the names only
 * older Traces still carry must survive both switch positions untouched, and turning the
 * switch off must hand back every name exactly as it came in.
 *
 * Which tools those are is taken from core's own registry rather than from a list repeated
 * here, so registering an eighth built-in tool without giving it a short name fails this
 * file instead of silently shipping one card that still reads as the model's wire name.
 */
import { afterEach, describe, expect, it } from "vitest";
import { BUILTIN_TOOL_FACTORIES } from "@prismshadow/penguin-core";
import { setActiveStrings } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { toolDisplayName } from "../src/lib/tool-alias";

/** Wire name -> alias, in the active language. */
const EN_ALIASES: Record<string, string> = {
  read_file: "read",
  write_file: "write",
  edit_file: "edit",
  exec_command: "exec",
  input_command: "follow",
  run_subagent: "subagent",
  input_subagent: "communicate",
};

/** Names that must pass through: an MCP tool, and tools no longer assembled but still in old Traces. */
const PASSTHROUGH = [
  "mcp__playwright__browser_click",
  "mcp__github__create_issue",
  "kill_command",
  "read_image",
  "describe_image",
  "kill_subagent",
];

afterEach(() => setActiveStrings(en));

describe("toolDisplayName", () => {
  it("names each built-in tool by its alias, in English", () => {
    setActiveStrings(en);
    for (const [name, alias] of Object.entries(EN_ALIASES)) {
      expect(toolDisplayName(name, true)).toBe(alias);
    }
  });

  it("passes MCP tools and historical names through with the switch on", () => {
    for (const name of PASSTHROUGH) {
      expect(toolDisplayName(name, true)).toBe(name);
    }
    setActiveStrings(en);
    for (const name of PASSTHROUGH) {
      expect(toolDisplayName(name, true)).toBe(name);
    }
  });

  it("returns every name unchanged with the switch off", () => {
    for (const name of [...Object.keys(EN_ALIASES), ...PASSTHROUGH, ""]) {
      expect(toolDisplayName(name, false)).toBe(name);
    }
  });

  it("aliases exactly core's built-in tools, in the English dictionary", () => {
    const builtins = Object.keys(BUILTIN_TOOL_FACTORIES).sort();
    expect(builtins).toEqual(Object.keys(EN_ALIASES).sort());
    expect(Object.keys(en.chat.toolAliases).sort()).toEqual(builtins);
  });
});
