/**
 * outdatedAgentIds unit tests: the skill-library update reminder's data source — Agents
 * whose installed copy is strictly older than the library's version.
 */
import { describe, expect, it } from "vitest";
import { outdatedAgentIds } from "../src/features/skills/skills-page";
import type { InstalledMap } from "../src/features/skills/skills-page";

const installed: InstalledMap = new Map([
  ["stale_agent", new Map([["agenthub-dev", 1]])],
  ["current_agent", new Map([["agenthub-dev", 2]])],
  ["ahead_agent", new Map([["agenthub-dev", 3]])],
  ["other_agent", new Map([["penguin-cli", 1]])],
]);
const AGENTS = ["stale_agent", "current_agent", "ahead_agent", "other_agent", "empty_agent"];

describe("outdatedAgentIds", () => {
  it("flags only strictly lower installed versions", () => {
    expect(outdatedAgentIds(AGENTS, installed, "agenthub-dev", 2)).toEqual(["stale_agent"]);
  });

  it("ignores not-installed Agents (including ones with no snapshot at all)", () => {
    // other_agent has a different skill installed; empty_agent never appears in the map.
    expect(outdatedAgentIds(AGENTS, installed, "agenthub-dev", 99)).toEqual([
      "stale_agent",
      "current_agent",
      "ahead_agent",
    ]);
    expect(outdatedAgentIds(["other_agent", "empty_agent"], installed, "agenthub-dev", 99)).toEqual(
      [],
    );
  });

  it("a locally newer copy does not trigger the reminder", () => {
    expect(outdatedAgentIds(["ahead_agent"], installed, "agenthub-dev", 2)).toEqual([]);
  });

  it("everything current -> no reminder", () => {
    expect(outdatedAgentIds(AGENTS, installed, "agenthub-dev", 1)).toEqual([]);
  });
});
