/**
 * tool-alias.ts unit tests: resolving a tool call's display name.
 *
 * The table covers the built-in tools and nothing else — an MCP tool and the names only
 * older Traces still carry must survive both switch positions untouched, and turning the
 * switch off must hand back every name exactly as it came in.
 */
import { afterEach, describe, expect, it } from "vitest";
import { setActiveStrings, zh } from "../src/lib/strings";
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

const ZH_ALIASES: Record<string, string> = {
  read_file: "读取",
  write_file: "写入",
  edit_file: "编辑",
  exec_command: "执行命令",
  input_command: "跟进命令",
  run_subagent: "子智能体",
  input_subagent: "交流",
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

afterEach(() => setActiveStrings(zh));

describe("toolDisplayName", () => {
  it("names each built-in tool by its alias, in either language", () => {
    setActiveStrings(en);
    for (const [name, alias] of Object.entries(EN_ALIASES)) {
      expect(toolDisplayName(name, true)).toBe(alias);
    }
    setActiveStrings(zh);
    for (const [name, alias] of Object.entries(ZH_ALIASES)) {
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
    for (const name of [...Object.keys(ZH_ALIASES), ...PASSTHROUGH, ""]) {
      expect(toolDisplayName(name, false)).toBe(name);
    }
  });

  it("aliases exactly the same set of tools in both dictionaries", () => {
    expect(Object.keys(zh.chat.toolAliases).sort()).toEqual(Object.keys(EN_ALIASES).sort());
    expect(Object.keys(en.chat.toolAliases).sort()).toEqual(Object.keys(EN_ALIASES).sort());
  });
});
