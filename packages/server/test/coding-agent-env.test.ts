/**
 * Coding-agent environment variables over HTTP: Vault-style replace with keep-by-key,
 * masking, admin-only visibility, and the built-in definitions the Local CLI routes may not touch.
 */
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CodingAgentsResponse } from "../src/api/types.js";
import { upgradeAdapterPackage } from "../src/coding-agents/service.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const AGENT_MAIN = fileURLToPath(new URL("./coding-agents-agent.mjs", import.meta.url));

describe("coding agent env", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;

  beforeEach(async () => {
    t = await createTestApp();
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    member = apiClient(t.app, (await provisionUser(t.app, "member_b")).cookie);
    expect(
      (
        await admin.post("/api/coding-agents/agents", {
          id: "fake",
          command: process.execPath,
          args: [AGENT_MAIN],
        })
      ).status,
    ).toBe(201);
  });
  afterEach(async () => t.cleanup());

  const agentsAs = async (client: typeof admin) =>
    ((await (await client.get("/api/coding-agents/agents")).json()) as CodingAgentsResponse).agents;

  it("stores values, returns them masked, and keeps a key sent without a value", async () => {
    const put = (entries: unknown) => admin.put("/api/coding-agents/agents/fake/env", { entries });
    expect(
      (
        await put([
          { key: "GEMINI_API_KEY", value: "AIzaSyExample1234567890" },
          { key: "SHORT", value: "abc" },
        ])
      ).status,
    ).toBe(200);
    let fake = (await agentsAs(admin)).find((a) => a.id === "fake")!;
    expect(fake.env).toEqual([
      { key: "GEMINI_API_KEY", valueMasked: "AIza…7890" },
      { key: "SHORT", valueMasked: "***" },
    ]);
    // Keep GEMINI_API_KEY by name, drop SHORT, add another.
    expect(
      (await put([{ key: "GEMINI_API_KEY" }, { key: "OTHER", value: "value-two" }])).status,
    ).toBe(200);
    fake = (await agentsAs(admin)).find((a) => a.id === "fake")!;
    expect(fake.env).toEqual([
      { key: "GEMINI_API_KEY", valueMasked: "AIza…7890" },
      { key: "OTHER", valueMasked: "***" },
    ]);
    expect(JSON.stringify(await agentsAs(admin))).not.toContain("AIzaSyExample1234567890");
  });

  it("refuses bad, reserved, duplicate and unknown keys and saves nothing", async () => {
    const put = (entries: unknown) => admin.put("/api/coding-agents/agents/fake/env", { entries });
    for (const entries of [
      [{ key: "PATH", value: "x" }],
      [{ key: "PENGUIN_X", value: "x" }],
      [{ key: "1BAD", value: "x" }],
      [{ key: "A", value: "a\nb" }],
      [
        { key: "A", value: "x" },
        { key: "A", value: "y" },
      ],
      [{ key: "NEVER_STORED" }],
    ]) {
      const res = await put(entries);
      expect(res.status).toBe(400);
    }
    expect((await agentsAs(admin)).find((a) => a.id === "fake")!.env).toEqual([]);
  });

  it("is admin-only to write, and members never see env", async () => {
    expect((await member.put("/api/coding-agents/agents/fake/env", { entries: [] })).status).toBe(
      403,
    );
    await admin.put("/api/coding-agents/agents/fake/env", {
      entries: [{ key: "K", value: "secret-value-123" }],
    });
    const fake = (await agentsAs(member)).find((a) => a.id === "fake")!;
    expect(fake).not.toHaveProperty("env");
    expect(fake).not.toHaveProperty("envPending");
  });

  it("keeps stored env when an agent is re-saved without env", async () => {
    await admin.put("/api/coding-agents/agents/fake/env", {
      entries: [{ key: "K", value: "secret-value-123" }],
    });
    expect(
      (
        await admin.post("/api/coding-agents/agents", {
          id: "fake",
          title: "Renamed",
          command: process.execPath,
          args: [AGENT_MAIN],
        })
      ).status,
    ).toBe(201);
    const fake = (await agentsAs(admin)).find((a) => a.id === "fake")!;
    expect(fake.title).toBe("Renamed");
    expect(fake.env).toEqual([{ key: "K", valueMasked: "secr…-123" }]);
  });

  it("keeps env through the adapter-package upgrade", () => {
    const upgraded = upgradeAdapterPackage({
      id: "codex",
      command: "npx",
      args: ["-y", "@zed-industries/codex-acp"],
      env: { K: "v" },
    });
    expect(upgraded.args).toEqual(["-y", "@agentclientprotocol/codex-acp"]);
    expect(upgraded.env).toEqual({ K: "v" });
  });

  it("keeps built-in definitions off the Local CLI routes", async () => {
    const service = t.deps.codingAgents;
    service.saveBuiltinDefinition({
      id: "copilot-builtin",
      title: "GitHub Copilot (built-in)",
      command: process.execPath,
      args: [AGENT_MAIN],
      env: { COPILOT_GITHUB_TOKEN: "github_pat_example_abcd" },
      builtin: "copilot",
    });
    const save = await admin.post("/api/coding-agents/agents", {
      id: "copilot-builtin",
      command: "x",
    });
    expect(save.status).toBe(400);
    expect(await save.text()).toMatch(/Built-in/);
    const env = await admin.put("/api/coding-agents/agents/copilot-builtin/env", { entries: [] });
    expect(env.status).toBe(400);
    const listed = (await agentsAs(admin)).find((a) => a.id === "copilot-builtin")!;
    expect(listed.builtin).toBe("copilot");
  });
});
