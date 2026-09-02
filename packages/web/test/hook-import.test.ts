/**
 * hook-import unit tests (src/features/agents/hook-import.ts): the tail the Hooks tab's AI
 * import appends names the install target by Project and Agent id and states the script
 * contract the agent writes against; the whole prompt is the draft plus that tail; the
 * examples are distinct and fill the draft; and both dictionaries carry the same contract
 * identifiers, so a language switch never changes what the agent is told.
 */
import { describe, expect, it } from "vitest";
import {
  buildHookImportPrompt,
  hookImportExamples,
  hookImportTail,
} from "../src/features/agents/hook-import";
import { zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

/** What the agent has to get right, whichever language the tail is in. */
const CONTRACT = [
  "hooks.json",
  "agent_state/hooks/<name>/",
  "YYYY-MM-DD.N",
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

describe("buildHookImportPrompt", () => {
  it("joins the trimmed draft and the tail with one blank line", () => {
    const prompt = buildHookImportPrompt("  Import my hooks  \n", "p", "a");
    expect(prompt.startsWith("Import my hooks\n\n")).toBe(true);
    expect(prompt.endsWith(hookImportTail("p", "a"))).toBe(true);
  });
});

describe("hookImportExamples", () => {
  it("offers distinct, non-empty examples that read S at call time", () => {
    for (const dict of [zh, en]) {
      const keys = dict.hooks.importExamples.map((ex) => ex.key);
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys.length).toBeGreaterThanOrEqual(3);
      for (const ex of dict.hooks.importExamples) {
        expect(ex.label.trim(), ex.key).not.toBe("");
        expect(ex.prompt.trim(), ex.key).not.toBe("");
      }
    }
    expect(hookImportExamples().map((ex) => ex.key)).toEqual(
      zh.hooks.importExamples.map((ex) => ex.key),
    );
  });
});
