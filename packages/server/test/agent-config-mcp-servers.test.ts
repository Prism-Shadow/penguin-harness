/**
 * The Agent config route's `mcpServers` list.
 *
 * - A PUT round-trips valid stdio and http entries into system_config.yaml, a plugin's
 *   provenance (`plugin`) and `${KEY}` vault references included, as written.
 * - An invalid entry is refused with a precise 400 from core's transport resolver (the runtime's
 *   own), so a broken server config cannot be saved and silently skipped at the next Session.
 * - POST /config/mcp-test lists a reachable server's prefixed tools, reports an unreachable one
 *   as ok:false with the connect failure, and refuses a malformed entry before connecting.
 * - mcp-test fills an entry's `${KEY}` references from the Agent's vault: a key the vault lacks
 *   answers ok:false naming it, without starting the server; once the key is set the server
 *   connects with the value.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { systemConfigPath } from "@prismshadow/penguin-core";
import type { AgentConfigResponse, ProjectCreateResponse } from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("agent config: mcpServers", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let projectId: string;
  let configPath: string;

  beforeAll(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner_mcp");
    owner = apiClient(t.app, a.cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });

  // Every case works in a Project of its own.
  let projects = 0;
  beforeEach(async () => {
    projects += 1;
    const created = (await (
      await owner.post("/api/projects", {
        projectId: `owner_mcp-mcp_${projects}`,
        name: "mcp project",
      })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
    configPath = `/api/projects/${projectId}/agents/default_agent/config`;
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

  it("PUT keeps a plugin's provenance and the entry's vault references as written", async () => {
    const servers = [
      {
        name: "cloudflare-api",
        plugin: "cloudflare",
        config: {
          url: "https://mcp.cloudflare.com/mcp",
          headers: { Authorization: "Bearer ${CLOUDFLARE_API_TOKEN}" },
        },
      },
    ];
    const res = await owner.put(configPath, { config: { mcpServers: servers } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as AgentConfigResponse).config.mcpServers).toEqual(servers);
    const refused = await owner.put(configPath, {
      config: { mcpServers: [{ ...servers[0], plugin: 7 }] },
    });
    expect(refused.status).toBe(400);
  });

  describe("POST /config/mcp-test", () => {
    // The core package's stdio fixture, reused across packages (monorepo-only path — tests
    // are not published); its @modelcontextprotocol/server import resolves from core's own
    // node_modules since resolution starts at the fixture's location. fileURLToPath, not
    // URL#pathname: the latter renders Windows paths as /D:/… which spawn cannot use.
    const FIXTURE = fileURLToPath(
      new URL("../../core/test/fixtures/mcp-stdio-server.mjs", import.meta.url),
    );

    it("connects to a reachable server and lists its prefixed tools", async () => {
      const res = await owner.post(`${configPath}/mcp-test`, {
        name: "fx",
        config: { command: process.execPath, args: [FIXTURE] },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; tools?: string[]; latencyMs?: number };
      expect(body.ok).toBe(true);
      expect(body.tools).toContain("mcp__fx__echo");
      expect(body.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("reports an unreachable server as ok: false with the connect failure detail", async () => {
      const res = await owner.post(`${configPath}/mcp-test`, {
        name: "broken",
        config: { command: "definitely-not-a-real-command-xyz" },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; error?: string };
      expect(body.ok).toBe(false);
      // The verdict and detail come from the per-server connect outcome (the raw spawn /
      // connect error), not from the warning text — benign warnings must not fail a probe.
      expect(body.error).toMatch(/definitely-not-a-real-command-xyz/);
    });

    it("fills the entry's vault references from the Agent's vault, and names a missing key without starting the server", async () => {
      const entry = {
        name: "fx",
        config: {
          command: process.execPath,
          args: [FIXTURE],
          env: { FIXTURE_SECRET: "${FIXTURE_SECRET}" },
        },
      };
      const missing = (await (await owner.post(`${configPath}/mcp-test`, entry)).json()) as {
        ok: boolean;
        error?: string;
        tools?: string[];
      };
      expect(missing).toMatchObject({
        ok: false,
        error: "needs setup: vault key FIXTURE_SECRET is not set",
      });
      expect(missing.tools).toBeUndefined();

      const vault = await owner.put(`/api/projects/${projectId}/agents/default_agent/vault`, {
        entries: [{ key: "FIXTURE_SECRET", value: "probe-value" }],
      });
      expect(vault.status).toBe(200);
      const res = await owner.post(`${configPath}/mcp-test`, entry);
      const body = (await res.json()) as { ok: boolean; tools?: string[] };
      expect(body.ok).toBe(true);
      expect(body.tools).toContain("mcp__fx__probe");
      expect(JSON.stringify(body)).not.toContain("probe-value");
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
