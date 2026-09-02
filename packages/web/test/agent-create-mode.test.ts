/**
 * Which path the Agents page's create dialog opens on (agent-create-mode.ts): a remembered
 * choice wins, and before any choice a Project with nothing beyond the built-in default agent
 * starts on the AI path while any other Project keeps the manual form.
 */
import { describe, expect, it } from "vitest";
import type { AgentSummary } from "@prismshadow/penguin-server/api";
import { resolveCreateMode } from "../src/features/agents/agent-create-mode";

const agent = (agentId: string) => ({ agentId, name: agentId }) as AgentSummary;

describe("resolveCreateMode", () => {
  it("starts on the AI path only while the Project has no agent of its own", () => {
    expect(resolveCreateMode(null, [agent("default_agent")])).toBe("ai");
    expect(resolveCreateMode(null, [])).toBe("ai");
    expect(resolveCreateMode(null, [agent("default_agent"), agent("report_writer")])).toBe(
      "manual",
    );
  });

  it("lets a remembered choice win over the first-run default", () => {
    expect(resolveCreateMode("manual", [agent("default_agent")])).toBe("manual");
    expect(resolveCreateMode("ai", [agent("default_agent"), agent("report_writer")])).toBe("ai");
  });
});
