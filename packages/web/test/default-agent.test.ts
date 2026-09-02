/**
 * Which agent a "Create with AI" surface sends to when none is named
 * (src/features/ai-create/default-agent.ts).
 */
import { describe, expect, it } from "vitest";
import type { AgentSummary } from "@prismshadow/penguin-server/api";
import { pickDefaultAgent } from "../src/features/ai-create/default-agent";

const agent = (agentId: string) => ({ agentId }) as AgentSummary;

describe("pickDefaultAgent", () => {
  it("prefers default_agent wherever it sits in the list", () => {
    expect(pickDefaultAgent([agent("a"), agent("default_agent"), agent("b")])?.agentId).toBe(
      "default_agent",
    );
  });

  it("falls back to the first agent, and to null for an empty list", () => {
    expect(pickDefaultAgent([agent("b"), agent("a")])?.agentId).toBe("b");
    expect(pickDefaultAgent([])).toBeNull();
  });
});
