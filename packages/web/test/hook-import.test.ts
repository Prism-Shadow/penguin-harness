/**
 * hook-import unit tests (src/features/agents/hook-import.ts): the lead sentence wraps a
 * fetchable source (URL / repo / local path) in an import instruction and passes free text
 * through verbatim; the tail names the install target by Project and Agent id and states the
 * script contract the agent writes against, identically in both dictionaries, so a language
 * switch never changes what the agent is told.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  buildHookImportPrompt,
  hookImportLead,
  hookImportTail,
} from "../src/features/agents/hook-import";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

/** What the agent has to get right, whichever language the tail is in. */
const CONTRACT = [
  "hooks.json",
  "agent_state/hooks/<name>/",
  "YYYY.MM.DD.N",
  "stop",
  "pre_tool_use",
  "user_prompt",
  "session_id",
  "trace_path",
  "tool_name",
  "tool_call_id",
  "arguments",
  "scratchpad_dir",
  '"continue" | "stop"',
  '"allow" | "deny"',
  '"context"',
  "^[A-Za-z0-9_-]+$",
];

describe("hookImportTail", () => {
  it("names the install target and states the script contract", () => {
    const tail = hookImportTail("proj_1", "writer");
    expect(tail).toContain("proj_1");
    expect(tail).toContain("writer");
    for (const token of CONTRACT) expect(tail, token).toContain(token);
  });

  it("carries the same contract in both dictionaries", () => {
    for (const dict of [zh, en]) {
      const tail = dict.hooks.importPromptTail("p", "a");
      for (const token of CONTRACT) expect(tail, token).toContain(token);
    }
  });
});

describe("hookImportLead", () => {
  afterEach(() => setActiveStrings(zh));

  it("wraps a fetchable source in the import sentence, in either language", () => {
    for (const dict of [zh, en]) {
      setActiveStrings(dict);
      for (const source of [
        "https://example.com/hooks",
        "https://github.com/org/my-hooks",
        "/path/to/hooks",
      ]) {
        expect(hookImportLead(source), source).toBe(dict.hooks.importPromptLead(source));
      }
    }
  });

  it("uses free text as the lead verbatim", () => {
    const description = "write a stop hook that appends changed files to CHANGELOG-agent.md";
    expect(hookImportLead(`  ${description}  `)).toBe(description);
    // A pasted config block is free text too, and must not be rewritten.
    const config = '{ "hooks": { "Stop": [] } }';
    expect(hookImportLead(config)).toBe(config);
  });
});

describe("buildHookImportPrompt", () => {
  it("joins the trimmed lead and the tail with one blank line", () => {
    const prompt = buildHookImportPrompt("  Import my hooks  \n", "p", "a");
    expect(prompt.startsWith("Import my hooks\n\n")).toBe(true);
    expect(prompt.endsWith(hookImportTail("p", "a"))).toBe(true);
  });
});
