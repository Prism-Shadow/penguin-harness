/**
 * The Agents page's bundle picker: the id it suggests from a picked file's name
 * (features/agents/agent-bundle-file.ts), and the download URL its export dialog builds.
 */
import { describe, expect, it } from "vitest";
import { agentBundleUrl } from "../src/api/endpoints";
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

describe("agentBundleUrl", () => {
  it("defaults to the api kind and adds pin only when asked", () => {
    expect(agentBundleUrl("p", "a")).toBe("/api/projects/p/agents/a/bundle?kind=api");
    expect(agentBundleUrl("p", "a", "docker")).toBe("/api/projects/p/agents/a/bundle?kind=docker");
    expect(agentBundleUrl("p", "a", "docker", true)).toBe(
      "/api/projects/p/agents/a/bundle?kind=docker&pin=1",
    );
  });

  it("encodes both ids", () => {
    expect(agentBundleUrl("p/1", "a b")).toBe("/api/projects/p%2F1/agents/a%20b/bundle?kind=api");
  });
});
