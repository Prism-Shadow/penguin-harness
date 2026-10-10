/**
 * Installing a plugin's MCP servers on an Agent: what lands in its system_config.yaml.
 *
 * - Installing appends the plugin's servers to `tools.mcpServers` in manifest order, each with
 *   the plugin's name as provenance, `${PLUGIN_ROOT}` replaced by the package's directory and
 *   the `${KEY}` vault references left as written.
 * - A server name the Agent already has from someone else — the user, or another plugin —
 *   refuses the whole install before any skill is written, naming the owner.
 * - Reinstalling replaces exactly the plugin's entries: a server the new version no longer
 *   ships is gone, the user's entries and the file's comments stay.
 * - Uninstalling a server removes exactly that entry.
 * - The listing reports, per entry, the vault keys it is missing by name and whether it needs a
 *   sign-in — never a value.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseDocument, parse as parseYaml } from "yaml";
import type { YAMLSeq } from "yaml";
import {
  libraryPlugin,
  useInstalledPluginPrefix,
  usePushedPluginLibrary,
} from "../src/plugins/index.js";
import {
  McpServerNameTakenError,
  assertPluginMcpServersInstallable,
  installPlugin,
  listInstalledMcpServers,
  loadAgentState,
  setVaultEntry,
  systemConfigPath,
  uninstallMcpServer,
} from "../src/state/index.js";

let root: string | null = null;

afterEach(async () => {
  usePushedPluginLibrary(null);
  useInstalledPluginPrefix(null);
  if (root !== null) await fs.rm(root, { recursive: true, force: true });
  root = null;
});

const PROJECT = "p1";
const AGENT = "a1";

/** Writes `files` under `dir` (paths relative to it). */
async function write(dir: string, files: Record<string, string>): Promise<void> {
  for (const [rel, data] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await fs.writeFile(path.join(dir, rel), data);
  }
}

const skill = (name: string) =>
  `---\nname: ${name}\ndescription: Do ${name}.\nversion: 2026.10.01.1\n---\n\nBody.\n`;

/** A plugin package's files: a package.json declaring `servers`, and one skill when `withSkill`. */
const toolsPackage = (servers: unknown[], withSkill = true): Record<string, string> => ({
  "package.json": JSON.stringify({
    name: "@acme/tools",
    version: "1.0.0",
    penguin: { mcp_servers: servers },
  }),
  ...(withSkill ? { "skills/tools-guide/SKILL.md": skill("tools-guide") } : {}),
});

/**
 * A data root with one Agent, and a server plugin prefix holding `packages` (npm name → files):
 * the library lists them as installed. Returns the prefix.
 */
async function setUp(packages: Record<string, Record<string, string>>): Promise<string> {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-plugin-mcp-"));
  const host = path.join(root, "host");
  await write(host, {
    "package.json": JSON.stringify({
      name: "host",
      dependencies: { "@penguinharness/sample": "*" },
    }),
    "node_modules/@penguinharness/sample/package.json": JSON.stringify({
      name: "@penguinharness/sample",
      version: "1.0.0",
      description: "Sample.",
    }),
    "node_modules/@penguinharness/sample/skills/sample/SKILL.md": skill("sample"),
  });
  const prefix = path.join(root, "prefix");
  await write(prefix, {
    "package.json": JSON.stringify({
      name: "penguin-plugins",
      private: true,
      dependencies: Object.fromEntries(Object.keys(packages).map((name) => [name, "*"])),
    }),
  });
  for (const [name, files] of Object.entries(packages)) {
    await write(path.join(prefix, "node_modules", ...name.split("/")), files);
  }
  usePushedPluginLibrary(host);
  useInstalledPluginPrefix(prefix);
  await loadAgentState({ root, projectId: PROJECT, agentId: AGENT, init: {} });
  return prefix;
}

const configFile = () => systemConfigPath(root!, PROJECT, AGENT);
const storedServers = async () =>
  (parseYaml(await fs.readFile(configFile(), "utf8")) as { tools: { mcpServers: unknown[] } }).tools
    .mcpServers;

/** Puts the user's own entry, with a comment above it, into the Agent's config. */
async function addOwnServer(name: string): Promise<void> {
  const doc = parseDocument(await fs.readFile(configFile(), "utf8"));
  const list = doc.getIn(["tools", "mcpServers"]) as YAMLSeq;
  const entry = doc.createNode({ name, config: { url: "https://own.example.com/mcp" } });
  entry.commentBefore = " my own server";
  list.flow = false;
  list.items.push(entry);
  await fs.writeFile(configFile(), doc.toString());
}

const cloudflare = {
  name: "cloudflare-api",
  config: {
    transport: "http",
    url: "https://mcp.cloudflare.com/mcp",
    headers: { Authorization: "Bearer ${CLOUDFLARE_API_TOKEN}" },
    oauth: {},
  },
};
const local = {
  name: "local-tools",
  config: { command: "node", args: ["${PLUGIN_ROOT}/server.mjs"], cwd: "${PLUGIN_ROOT}" },
};

describe("a plugin's MCP servers on an Agent", () => {
  it("appends the plugin's servers with provenance, resolving ${PLUGIN_ROOT} to the package directory and leaving vault references as written", async () => {
    const prefix = await setUp({ "@acme/tools": toolsPackage([cloudflare, local]) });
    await installPlugin(root!, PROJECT, AGENT, libraryPlugin("tools")!);
    const dir = path.join(prefix, "node_modules", "@acme", "tools");
    expect(await storedServers()).toEqual([
      { name: "cloudflare-api", plugin: "tools", config: cloudflare.config },
      {
        name: "local-tools",
        plugin: "tools",
        config: { command: "node", args: [`${dir}/server.mjs`], cwd: dir },
      },
    ]);
    // The skills land beside them, as before.
    await expect(
      fs.access(path.join(root!, PROJECT, "agents", AGENT, "agent_state", "skills", "tools-guide")),
    ).resolves.toBeUndefined();
  });

  it("refuses the whole install before any skill is written when the user already has a server by that name", async () => {
    await setUp({ "@acme/tools": toolsPackage([cloudflare]) });
    await addOwnServer("cloudflare-api");
    const before = await fs.readFile(configFile(), "utf8");
    const install = installPlugin(root!, PROJECT, AGENT, libraryPlugin("tools")!);
    await expect(install).rejects.toBeInstanceOf(McpServerNameTakenError);
    await expect(install).rejects.toThrow(
      "MCP server 'cloudflare-api' already exists on agent 'a1' and was added by hand; rename or remove it first. Nothing was installed.",
    );
    expect(await fs.readFile(configFile(), "utf8")).toBe(before);
    await expect(
      fs.access(path.join(root!, PROJECT, "agents", AGENT, "agent_state", "skills", "tools-guide")),
    ).rejects.toThrow();
  });

  it("refuses a request whose plugins ship the same server name, naming the plugin that holds it", async () => {
    await setUp({
      "@acme/tools": toolsPackage([cloudflare]),
      "@acme/cf": {
        "package.json": JSON.stringify({
          name: "@acme/cf",
          version: "1.0.0",
          penguin: { mcp_servers: [cloudflare] },
        }),
      },
    });
    await expect(
      assertPluginMcpServersInstallable(root!, PROJECT, AGENT, [
        libraryPlugin("tools")!,
        libraryPlugin("cf")!,
      ]),
    ).rejects.toThrow("and belongs to plugin 'tools'");
    expect(await storedServers()).toEqual([]);
  });

  it("reinstalling replaces exactly the plugin's entries, keeping the user's entries and the file's comments", async () => {
    const prefix = await setUp({ "@acme/tools": toolsPackage([cloudflare, local]) });
    await addOwnServer("mine");
    await installPlugin(root!, PROJECT, AGENT, libraryPlugin("tools")!);

    // The next version drops local-tools and changes the address of cloudflare-api.
    const moved = {
      ...cloudflare,
      config: { ...cloudflare.config, url: "https://v2.example/mcp" },
    };
    await write(path.join(prefix, "node_modules", "@acme", "tools"), toolsPackage([moved]));
    await installPlugin(root!, PROJECT, AGENT, libraryPlugin("tools")!);
    await installPlugin(root!, PROJECT, AGENT, libraryPlugin("tools")!);

    expect(await storedServers()).toEqual([
      { name: "mine", config: { url: "https://own.example.com/mcp" } },
      { name: "cloudflare-api", plugin: "tools", config: moved.config },
    ]);
    expect(await fs.readFile(configFile(), "utf8")).toContain("# my own server");
  });

  it("uninstalling a server removes exactly that entry, whoever added it", async () => {
    await setUp({ "@acme/tools": toolsPackage([cloudflare, local]) });
    await addOwnServer("mine");
    await installPlugin(root!, PROJECT, AGENT, libraryPlugin("tools")!);
    expect(await uninstallMcpServer(root!, PROJECT, AGENT, "local-tools")).toBe(true);
    expect(await uninstallMcpServer(root!, PROJECT, AGENT, "mine")).toBe(true);
    expect(await uninstallMcpServer(root!, PROJECT, AGENT, "mine")).toBe(false);
    expect(await storedServers()).toEqual([
      { name: "cloudflare-api", plugin: "tools", config: cloudflare.config },
    ]);
  });

  it("lists each server with the vault keys it is missing, by name, and whether it needs a sign-in", async () => {
    const mail = {
      name: "mail",
      config: {
        url: "https://mail.example.com/mcp",
        oauth: { client_id: "${MAIL_CLIENT_ID}", client_secret: "${MAIL_CLIENT_SECRET}" },
      },
    };
    await setUp({ "@acme/tools": toolsPackage([cloudflare, mail], false) });
    await installPlugin(root!, PROJECT, AGENT, libraryPlugin("tools")!);
    await setVaultEntry(root!, PROJECT, AGENT, "MAIL_CLIENT_ID", "id-value-not-listed");

    const listed = await listInstalledMcpServers(root!, PROJECT, AGENT);
    expect(listed.map((s) => [s.entry.name, s.entry.plugin, s.missingKeys, s.signIn])).toEqual([
      ["cloudflare-api", "tools", ["CLOUDFLARE_API_TOKEN"], false],
      ["mail", "tools", ["MAIL_CLIENT_SECRET"], true],
    ]);
    expect(JSON.stringify(listed)).not.toContain("id-value-not-listed");
  });
});
