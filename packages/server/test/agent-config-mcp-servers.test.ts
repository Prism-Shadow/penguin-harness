/**
 * Agent config route: the `mcpServers` list. PUT round-trips valid entries into
 * system_config.yaml; invalid entries are rejected with a precise 400 through the core
 * transport resolver (single source of truth with the runtime), so a broken server config
 * cannot be saved and silently skipped at the next Session start.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import { systemConfigPath } from "@prismshadow/penguin-core";
import type { AgentConfigResponse, ProjectCreateResponse } from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("agent config: mcpServers", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let projectId: string;
  let configPath: string;

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner_mcp");
    owner = apiClient(t.app, a.cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner_mcp-mcp", name: "mcp project" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
    configPath = `/api/projects/${projectId}/agents/default_agent/config`;
  });

  afterEach(async () => {
    await t.cleanup();
  });

  it("PUT round-trips valid stdio and http entries into the YAML", async () => {
    const servers = [
      { name: "fs", config: { command: "npx", args: ["-y", "pkg"], env: { A: "1" } } },
      {
        name: "web",
        config: { transport: "http", url: "https://example.com/mcp", headers: { "x-k": "v" } },
      },
    ];
    const putRes = await owner.put(configPath, { config: { mcpServers: servers } });
    expect(putRes.status).toBe(200);
    const updated = (await putRes.json()) as AgentConfigResponse;
    expect(updated.config.mcpServers).toEqual(servers);
    const yaml = await fs.readFile(systemConfigPath(t.root, projectId, "default_agent"), "utf8");
    expect(yaml).toContain("mcpServers:");
    expect(yaml).toContain("https://example.com/mcp");
  });

  describe("POST /config/mcp-test", () => {
    // The core package's stdio fixture, reused across packages (monorepo-only path — tests
    // are not published); its @modelcontextprotocol/server import resolves from core's own
    // node_modules since resolution starts at the fixture's location.
    const FIXTURE = new URL("../../core/test/fixtures/mcp-stdio-server.mjs", import.meta.url)
      .pathname;

    it("connects to a reachable server and lists its prefixed tools", async () => {
      const res = await owner.post(`${configPath}/mcp-test`, {
        name: "fx",
        config: { command: process.execPath, args: [FIXTURE] },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; tools?: string[] };
      expect(body.ok).toBe(true);
      expect(body.tools).toContain("mcp__fx__echo");
    });

    it("reports an unreachable server as ok: false with the warning detail", async () => {
      const res = await owner.post(`${configPath}/mcp-test`, {
        name: "broken",
        config: { command: "definitely-not-a-real-command-xyz" },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; error?: string };
      expect(body.ok).toBe(false);
      expect(body.error).toMatch(/unavailable/);
    });

    it("rejects a malformed entry with 400 before attempting to connect", async () => {
      const res = await owner.post(`${configPath}/mcp-test`, {
        name: "a",
        config: { transport: "ws" },
      });
      expect(res.status).toBe(400);
    });
  });

  it.each([
    ["unknown transport", [{ name: "a", config: { transport: "ws" } }], /unknown transport/],
    [
      "name unusable as a tool prefix",
      [{ name: "no spaces", config: { command: "x" } }],
      /invalid server name/,
    ],
    ["nothing to infer the transport from", [{ name: "a", config: {} }], /cannot infer transport/],
    [
      "duplicate server names",
      [
        { name: "a", config: { command: "x" } },
        { name: "a", config: { command: "y" } },
      ],
      /duplicate server name/,
    ],
  ])("rejects %s with 400", async (_label, servers, pattern) => {
    const res = await owner.put(configPath, { config: { mcpServers: servers } });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { message?: string } };
    expect(body.error?.message).toMatch(pattern);
  });
});
