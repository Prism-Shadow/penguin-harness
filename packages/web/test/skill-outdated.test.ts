/**
 * The Skills page's two update questions: `outdatedAgentIds`, the per-Skill reminder's data
 * source — Agents whose installed copy is strictly older than the library's version — and
 * `skillUpdatePlan`, the page notice's "update all of them" version of the same question.
 */
import { describe, expect, it } from "vitest";
import { outdatedAgentIds, skillUpdatePlan } from "../src/features/skills/skills-page";
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

describe("skillUpdatePlan", () => {
  /** Just the two fields the plan reads (it takes a Pick, so the fixture can be one too). */
  const agent = (agentId: string, ...updates: Array<{ name: string; version: number }>) => ({
    agentId,
    skillUpdates: updates,
  });

  it("is empty when no Agent is behind, so the notice has nothing to offer", () => {
    expect(skillUpdatePlan([agent("a"), agent("b")])).toEqual({ perAgent: [], skills: [] });
  });

  it("sends one request per Agent, carrying every Skill that Agent is behind on", () => {
    // The install endpoint takes a list, and an Agent behind on two Skills is one overwrite of
    // its skills directory either way.
    expect(
      skillUpdatePlan([
        agent("alpha", { name: "web-design", version: 3 }, { name: "vllm", version: 2 }),
        agent("beta"),
        agent("gamma", { name: "web-design", version: 3 }),
      ]),
    ).toEqual({
      perAgent: [
        { agentId: "alpha", names: ["vllm", "web-design"] },
        { agentId: "gamma", names: ["web-design"] },
      ],
      skills: ["vllm", "web-design"],
    });
  });

  it("counts distinct Skills, matching what the notice above the button says", () => {
    // The gate counts by Skill because the page lists the library once. The plan's `skills` is
    // what the confirmation lists, so the two must be the same number or the dialog would
    // contradict the block that opened it.
    const plan = skillUpdatePlan([
      agent("alpha", { name: "shared", version: 2 }),
      agent("beta", { name: "shared", version: 2 }),
      agent("gamma", { name: "shared", version: 2 }),
    ]);
    expect(plan.skills).toEqual(["shared"]);
    expect(plan.perAgent).toHaveLength(3);
  });

  it("tolerates an Agent list that predates the skillUpdates field", () => {
    expect(skillUpdatePlan([{ agentId: "alpha", skillUpdates: undefined! }]).perAgent).toEqual([]);
  });
});
