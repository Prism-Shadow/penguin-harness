/**
 * A tool call's display name (lib/tool-alias.ts).
 *
 * - With the switch on, every built-in tool of core's registry reads as a short name of its
 *   own, in either language.
 * - An MCP tool and the names only older Traces carry pass through untouched.
 * - With the switch off, every name comes back exactly as it came in.
 * - Both dictionaries alias exactly core's built-in tools, so registering a new built-in tool
 *   without a short name fails here instead of shipping a card that reads as the wire name.
 */
import { afterEach, describe, expect, it } from "vitest";
import { BUILTIN_TOOL_FACTORIES } from "@prismshadow/penguin-core";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { toolDisplayName } from "../src/lib/tool-alias";

/** Core's built-in tools, by wire name. */
const BUILTINS = Object.keys(BUILTIN_TOOL_FACTORIES).sort();

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
  it("names each built-in tool by a short name of its own, in either language", () => {
    for (const strings of [en, zh]) {
      setActiveStrings(strings);
      const names = BUILTINS.map((name) => toolDisplayName(name, true));
      for (const [i, name] of names.entries()) expect(name).not.toBe(BUILTINS[i]);
      expect(new Set(names).size).toBe(BUILTINS.length);
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
    for (const name of [...BUILTINS, ...PASSTHROUGH, ""]) {
      expect(toolDisplayName(name, false)).toBe(name);
    }
  });

  it("aliases exactly core's built-in tools, in both dictionaries", () => {
    expect(Object.keys(zh.chat.toolAliases).sort()).toEqual(BUILTINS);
    expect(Object.keys(en.chat.toolAliases).sort()).toEqual(BUILTINS);
  });
});
