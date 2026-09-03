/** The Agents page's bundle picker: the id it suggests from a picked file's name (features/agents/agent-bundle-file.ts). */
import { describe, expect, it } from "vitest";
import { agentIdFromBundleName } from "../src/features/agents/agent-bundle-file";

describe("agentIdFromBundleName", () => {
  it("strips the -export suffix and the extension of an exported bundle", () => {
    expect(agentIdFromBundleName("researcher-export.zip")).toBe("researcher");
    expect(agentIdFromBundleName("researcher.zip")).toBe("researcher");
    expect(agentIdFromBundleName("helper_2.JSON")).toBe("helper_2");
  });

  it("suggests nothing for a bare definition file", () => {
    expect(agentIdFromBundleName("penguin-agent.json")).toBe("");
  });
});
