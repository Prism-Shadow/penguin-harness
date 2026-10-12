/**
 * The Agent config route's `mcpServers` list.
 *
 * - A PUT round-trips valid stdio and http entries into system_config.yaml, a plugin's
 *   provenance (`plugin`) and `${KEY}` vault references included, as written.
 * - An invalid entry is refused with a precise 400 from core's transport resolver (the runtime's
 *   own), so a broken server config cannot be saved and silently skipped at the next Session.
 * - POST /config/mcp-test lists a reachable server's prefixed tools, reports an unreachable one
 *   as ok:false with the connect failure, and refuses a malformed entry before connecting.
 * - mcp-test fills an entry's `${KEY}` references from the Agent's vault only when the entry is
 *   saved on the Agent as tested: a key the vault lacks answers ok:false naming it, without
 *   starting the server; once the key is set the server connects with the value.
 * - A new or changed entry that references the vault gets no value, whoever tests it and
 *   whatever address it names: the answer says to save it first, and nothing is contacted.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { systemConfigPath } from "@prismshadow/penguin-core";
import type {
  AgentConfigResponse,
  McpServerTestResponse,
  ProjectCreateResponse,
} from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("agent config: mcpServers", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  /** A second user, made a member of the Project by the case that needs one. */
  let member: ReturnType<typeof apiClient>;
  let projectId: string;
  let configPath: string;

  beforeAll(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner_mcp");
    owner = apiClient(t.app, a.cookie);
    member = apiClient(t.app, (await provisionUser(t.app, "member_mcp")).cookie);
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

    it("fills the vault into an entry saved on the Agent as tested, and names a key the vault lacks without starting the server", async () => {
      const entry = {
        name: "fx",
        config: {
          command: process.execPath,
          args: [FIXTURE],
          env: { FIXTURE_SECRET: "${FIXTURE_SECRET}" },
        },
      };
      expect((await owner.put(configPath, { config: { mcpServers: [entry] } })).status).toBe(200);
      const missing = (await (
        await owner.post(`${configPath}/mcp-test`, entry)
      ).json()) as McpServerTestResponse;
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
      const body = (await res.json()) as McpServerTestResponse;
      expect(body.ok).toBe(true);
      expect(body.tools).toContain("mcp__fx__probe");
      expect(JSON.stringify(body)).not.toContain("probe-value");
    });

    describe("an entry not saved as it is", () => {
      // Every request that reaches this address: whether a test contacted it, and with which
      // Authorization header.
      let capture: Server;
      let base: string;
      const received: (string | undefined)[] = [];

      beforeAll(async () => {
        capture = createServer((req, res) => {
          received.push(req.headers.authorization);
          res.writeHead(404).end();
        });
        await new Promise<void>((resolve) => capture.listen(0, "127.0.0.1", resolve));
        base = `http://127.0.0.1:${(capture.address() as AddressInfo).port}`;
      });
      afterAll(async () => {
        await new Promise((resolve) => capture.close(resolve));
      });

      it("gets no vault value, even at an address a member types: the answer says to save it first, and nothing is contacted", async () => {
        received.length = 0;
        const savedEntry = {
          name: "web",
          config: { url: `${base}/saved`, headers: { Authorization: "Bearer ${WEB_TOKEN}" } },
        };
        expect((await owner.put(configPath, { config: { mcpServers: [savedEntry] } })).status).toBe(
          200,
        );
        expect(
          (
            await owner.put(`/api/projects/${projectId}/agents/default_agent/vault`, {
              entries: [{ key: "WEB_TOKEN", value: "web-token-value" }],
            })
          ).status,
        ).toBe(200);
        expect(
          (await owner.post(`/api/projects/${projectId}/members`, { userId: "member_mcp" })).status,
        ).toBe(201);

        // The saved entry's name with the member's own address, and an entry of their own.
        for (const probe of [
          { name: "web", config: { ...savedEntry.config, url: `${base}/mine` } },
          { name: "mine", config: { url: `${base}/mine`, headers: { "X-Key": "${WEB_TOKEN}" } } },
        ]) {
          const body = (await (
            await member.post(`${configPath}/mcp-test`, probe)
          ).json()) as McpServerTestResponse;
          expect(body).toMatchObject({ ok: false, saveFirst: true });
          expect(body.error).toMatch(/save this entry first/i);
        }
        expect(received).toEqual([]);

        // The saved entry itself is filled in: its own address receives the value.
        const saved = (await (
          await member.post(`${configPath}/mcp-test`, savedEntry)
        ).json()) as McpServerTestResponse;
        expect(saved.ok).toBe(false);
        expect(saved.saveFirst).toBeUndefined();
        expect(received.length).toBeGreaterThan(0);
        expect(received.every((header) => header === "Bearer web-token-value")).toBe(true);
      });
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
