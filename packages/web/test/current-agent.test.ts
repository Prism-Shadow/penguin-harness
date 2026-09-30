import { describe, expect, it } from "vitest";
import type { AgentSummary } from "@prismshadow/penguin-server/api";
import { agentOf } from "../src/state/project";

const agent = (agentId: string) => ({ agentId }) as AgentSummary;

describe("agentOf — the current Agent is always one of this server's", () => {
  const agents = [agent("writer"), agent("default_agent"), agent("reviewer")];

  it("returns the Agent the id names", () => {
    expect(agentOf(agents, "reviewer")?.agentId).toBe("reviewer");
  });

  it("falls back to default_agent for an id only a machine has", () => {
    // A draft on a machine follows its pick through to the current Agent; resolving that id to
    // null left the chat page, which waits on a current Agent, on its placeholder for good.
    expect(agentOf(agents, "ema")?.agentId).toBe("default_agent");
    expect(agentOf(agents, null)?.agentId).toBe("default_agent");
  });

  it("falls back to the first Agent when there is no default_agent, and to null when there are none", () => {
    expect(agentOf([agent("writer"), agent("reviewer")], "ema")?.agentId).toBe("writer");
    expect(agentOf([], "ema")).toBeNull();
  });
});
