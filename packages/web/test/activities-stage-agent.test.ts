import { describe, expect, it } from "vitest";
import { ACTIVITY_AGENT_ID, stageAgent } from "../src/features/activities/stage-agent";

const builtins = [
  { agentId: "default_agent" },
  { agentId: "media_agent" },
  { agentId: ACTIVITY_AGENT_ID },
];

describe("the agent a stage runs on", () => {
  it("is the Activity Agent unless the author picks another", () => {
    expect(stageAgent("", builtins, "default_agent")).toBe(ACTIVITY_AGENT_ID);
    expect(stageAgent("default_agent", builtins, "default_agent")).toBe("default_agent");
    expect(stageAgent("coding:codex", builtins, "default_agent")).toBe("coding:codex");
  });

  it("falls back to the agent in use when the list predates the Activity Agent", () => {
    const older = builtins.slice(0, 2);
    expect(stageAgent("", older, "media_agent")).toBe("media_agent");
    expect(stageAgent("", older, undefined)).toBe("default_agent");
    expect(stageAgent("", [], undefined)).toBe("");
  });
});
