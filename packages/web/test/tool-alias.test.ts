/**
 * A tool call's display name (lib/tool-alias.ts).
 *
 * - With the switch on, a built-in tool reads as its short name, in the active language.
 * - An MCP tool and the names only older Traces carry pass through untouched.
 * - With the switch off, every name comes back exactly as it came in.
 */
import { afterEach, describe, expect, it } from "vitest";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { toolDisplayName } from "../src/lib/tool-alias";

/** Built-in tools, by wire name. */
const BUILTINS = ["exec_command", "read_file", "run_subagent"];

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
  it("names a built-in tool by its short name, in the active language", () => {
    setActiveStrings(en);
    const english = toolDisplayName("exec_command", true);
    setActiveStrings(zh);
    const chinese = toolDisplayName("exec_command", true);

    expect(english).not.toBe("exec_command");
    expect(chinese).not.toBe("exec_command");
    expect(chinese).not.toBe(english);
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
    for (const name of [...BUILTINS, ...PASSTHROUGH, ""]) {
      expect(toolDisplayName(name, false)).toBe(name);
    }
  });
});
