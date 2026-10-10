/**
 * A plugin's MCP servers on an Agent, through the routes the Plugins page and the Agent settings
 * use.
 *
 * - Installing a plugin from the library writes its servers into the Agent's
 *   `tools.mcpServers` and answers them: provenance, transport, target, the vault keys still
 *   missing and whether a sign-in is needed — never a header or env value. The config route
 *   shows the entries with their `${KEY}` references as written.
 * - GET …/mcp-servers lists the Agent's servers the same way; a key set in the vault drops out
 *   of the missing ones.
 * - DELETE …/mcp-servers/:name removes exactly that server; a name the Agent does not have is
 *   404.
 * - A server name the Agent already has from someone else refuses the whole install with 409
 *   `mcp_server_name_taken`, naming the server and the Agent; nothing is installed — not the
 *   plugin's skills either.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AgentConfigResponse,
  AgentMcpServersResponse,
  AgentPluginsInstallResponse,
  AgentSkillsResponse,
} from "../src/api/types.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const AGENT = "/api/projects/default_project/agents/default_agent";
const DUMMY_TOKEN = "dummy-token-not-a-secret";

const cloudflare = {
  name: "cloudflare-api",
  config: {
    transport: "http",
    url: "https://mcp.cloudflare.com/mcp",
    headers: { Authorization: "Bearer ${CLOUDFLARE_API_TOKEN}" },
    oauth: {},
  },
  setup: [{ key: "CLOUDFLARE_API_TOKEN", label: "Cloudflare API token" }],
};
const local = {
  name: "cf-local",
  config: { command: "node", args: ["${PLUGIN_ROOT}/server.mjs", "--verbose"] },
};

describe("a plugin's MCP servers on an Agent", () => {
  let t: TestApp;

  afterEach(async () => {
    await t.cleanup();
  });

  /**
   * A server with `@acme/cf` installed in its plugin prefix — one skill and two MCP servers —
   * as an admin's import would leave it. Returns the admin's client.
   */
  const boot = async () => {
    t = await createTestApp();
    const prefix = path.join(t.root, "plugins");
    const dir = path.join(prefix, "node_modules", "@acme", "cf");
    await fs.mkdir(path.join(dir, "skills", "cf-guide"), { recursive: true });
    await fs.writeFile(
      path.join(prefix, "package.json"),
      JSON.stringify({ name: "penguin-plugins", private: true, dependencies: { "@acme/cf": "*" } }),
    );
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "@acme/cf",
        version: "0.1.2",
        penguin: { mcp_servers: [cloudflare, local] },
      }),
    );
    await fs.writeFile(
      path.join(dir, "skills", "cf-guide", "SKILL.md"),
      "---\nname: cf-guide\ndescription: Use the Cloudflare tools.\nversion: 2026.10.11.1\n---\n\nBody.\n",
    );
    return { admin: apiClient(t.app, (await loginAdmin(t.app)).cookie), dir };
  };

  it("installs the plugin's servers, lists them with what is missing, and removes one", async () => {
    const { admin, dir } = await boot();
    const installed = await admin.post(`${AGENT}/plugins`, { names: ["cf"] });
    expect(installed.status).toBe(201);
    const body = (await installed.json()) as AgentPluginsInstallResponse;
    expect(body.skills.map((s) => s.name)).toContain("cf-guide");
    expect(body.mcpServers).toEqual([
      {
        name: "cloudflare-api",
        transport: "http",
        target: "https://mcp.cloudflare.com/mcp",
        plugin: "cf",
        missingKeys: ["CLOUDFLARE_API_TOKEN"],
        signIn: false,
      },
      {
        name: "cf-local",
        transport: "stdio",
        target: `node ${dir}/server.mjs --verbose`,
        plugin: "cf",
        missingKeys: [],
        signIn: false,
      },
    ]);

    // A value in the vault: the server has nothing left to set up, and no value travels.
    const vault = await admin.put(`${AGENT}/vault`, {
      entries: [{ key: "CLOUDFLARE_API_TOKEN", value: DUMMY_TOKEN }],
    });
    expect(vault.status).toBe(200);
    const listed = (await (
      await admin.get(`${AGENT}/mcp-servers`)
    ).json()) as AgentMcpServersResponse;
    expect(listed.servers.map((s) => [s.name, s.missingKeys])).toEqual([
      ["cloudflare-api", []],
      ["cf-local", []],
    ]);
    const config = (await (await admin.get(`${AGENT}/config`)).json()) as AgentConfigResponse;
    expect(config.config.mcpServers[0]).toEqual({
      name: "cloudflare-api",
      plugin: "cf",
      config: cloudflare.config,
    });
    expect(JSON.stringify([listed, config])).not.toContain(DUMMY_TOKEN);

    expect((await admin.delete(`${AGENT}/mcp-servers/cf-local`)).status).toBe(204);
    const after = (await (
      await admin.get(`${AGENT}/mcp-servers`)
    ).json()) as AgentMcpServersResponse;
    expect(after.servers.map((s) => s.name)).toEqual(["cloudflare-api"]);
    const again = await admin.delete(`${AGENT}/mcp-servers/cf-local`);
    expect(again.status).toBe(404);
    expect(await again.json()).toMatchObject({ error: { code: "unknown_mcp_server" } });
  });

  it("refuses the whole install when the Agent already has a server by that name, installing nothing", async () => {
    const { admin } = await boot();
    const own = [{ name: "cloudflare-api", config: { url: "https://own.example.com/mcp" } }];
    expect((await admin.put(`${AGENT}/config`, { config: { mcpServers: own } })).status).toBe(200);

    const res = await admin.post(`${AGENT}/plugins`, { names: ["cf"] });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: {
        code: "mcp_server_name_taken",
        message:
          "MCP server 'cloudflare-api' already exists on agent 'default_agent' and was added by hand; rename or remove it first. Nothing was installed.",
      },
    });
    const skills = (await (await admin.get(`${AGENT}/skills`)).json()) as AgentSkillsResponse;
    expect(skills.skills.map((s) => s.name)).not.toContain("cf-guide");
    const servers = (await (
      await admin.get(`${AGENT}/mcp-servers`)
    ).json()) as AgentMcpServersResponse;
    expect(servers.servers).toEqual([
      {
        name: "cloudflare-api",
        transport: "http",
        target: "https://own.example.com/mcp",
        missingKeys: [],
        signIn: false,
      },
    ]);
  });
});
