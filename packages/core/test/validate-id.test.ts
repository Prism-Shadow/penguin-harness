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

  it.each(valid)("接受合法单段目录名：%j", (id) => {
    expect(isValidId(id)).toBe(true);
    expect(() => assertValidId("project_id", id)).not.toThrow();
    expect(() => assertValidId("agent_id", id)).not.toThrow();
  });

  it.each(invalid)("拒绝非法 id：%j", (id) => {
    expect(isValidId(id)).toBe(false);
    expect(() => assertValidId("agent_id", id)).toThrow();
  });

  it("错误信息点明 kind 与非法 id", () => {
    expect(() => assertValidId("agent_id", "a/b")).toThrow(/agent_id/);
    expect(() => assertValidId("agent_id", "a/b")).toThrow(/a\/b/);
    expect(() => assertValidId("project_id", "..")).toThrow(/project_id/);
  });
});

describe("loadOrInitAgentState id 校验", () => {
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

  it("agentId 含路径分隔符时抛错", async () => {
    await expect(loadOrInitAgentState({ agentId: "a/b" })).rejects.toThrow(/agent_id/);
  });

  it("projectId 为 .. 时抛错", async () => {
    await expect(loadOrInitAgentState({ projectId: ".." })).rejects.toThrow(/project_id/);
  });

  it("agentId 为 Windows 结尾空格变体 '.. ' 时抛错（防路径穿越绕过）", async () => {
    await expect(loadOrInitAgentState({ agentId: ".. " })).rejects.toThrow(/agent_id/);
  });

  it("默认 id 合法，可正常初始化", async () => {
    const state = await loadOrInitAgentState();
    expect(state.projectId).toBe("default_project");
    expect(state.agentId).toBe("default_agent");
  });
});
