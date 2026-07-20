import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertValidId, isValidId, loadOrInitAgentState } from "../src/state/index.js";

describe("isValidId / assertValidId", () => {
  const valid = ["default_project", "default_agent", "my-agent", "agent-1", "ABC_123"];
  // Only alphanumerics, `_`, and `-` are allowed; dots, spaces/tabs, path separators, and any
  // other character are all rejected.
  const invalid = [
    "",
    "   ",
    "a b",
    "a\tb",
    " lead",
    "trail ",
    "a/b",
    "a\\b",
    ".",
    "..",
    "...",
    "a.b",
    "v1.0",
    ".hidden",
    "中文ok",
    "emoji😀",
  ];

  it.each(valid)("accepts a valid single-segment directory name: %j", (id) => {
    expect(isValidId(id)).toBe(true);
    expect(() => assertValidId("project_id", id)).not.toThrow();
    expect(() => assertValidId("agent_id", id)).not.toThrow();
  });

  it.each(invalid)("rejects an invalid id: %j", (id) => {
    expect(isValidId(id)).toBe(false);
    expect(() => assertValidId("agent_id", id)).toThrow();
  });

  it("the error message names the kind and the invalid id", () => {
    expect(() => assertValidId("agent_id", "a/b")).toThrow(/agent_id/);
    expect(() => assertValidId("agent_id", "a/b")).toThrow(/a\/b/);
    expect(() => assertValidId("project_id", "..")).toThrow(/project_id/);
  });
});

describe("loadOrInitAgentState id validation", () => {
  let tmpRoot: string;
  let prevHome: string | undefined;

  beforeEach(async () => {
    prevHome = process.env.PENGUIN_HOME;
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-validate-id-"));
    process.env.PENGUIN_HOME = tmpRoot;
  });

  afterEach(async () => {
    if (prevHome === undefined) {
      delete process.env.PENGUIN_HOME;
    } else {
      process.env.PENGUIN_HOME = prevHome;
    }
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("throws when agentId contains a path separator", async () => {
    await expect(loadOrInitAgentState({ agentId: "a/b" })).rejects.toThrow(/agent_id/);
  });

  it("throws when projectId is ..", async () => {
    await expect(loadOrInitAgentState({ projectId: ".." })).rejects.toThrow(/project_id/);
  });

  it("throws on the Windows trailing-space variant '.. ' as agentId (blocks a path-traversal bypass)", async () => {
    await expect(loadOrInitAgentState({ agentId: ".. " })).rejects.toThrow(/agent_id/);
  });

  it("the default ids are valid and initialization succeeds", async () => {
    const state = await loadOrInitAgentState();
    expect(state.projectId).toBe("default_project");
    expect(state.agentId).toBe("default_agent");
  });
});
