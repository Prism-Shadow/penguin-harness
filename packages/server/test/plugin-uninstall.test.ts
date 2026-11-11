/**
 * Uninstalling a whole plugin from an Agent: DELETE /api/projects/:p/agents/:a/plugins/:name.
 *
 * - Given an Agent with plugin `kit` installed (two Skills, a hook package, two MCP servers and a
 *   workbench that has loaded once), beside another plugin's hook package named like one of
 *   kit's Skills and an MCP server the user added, when the owner uninstalls kit, then every part
 *   kit put there is gone from its listing and named in the answer, the workbench's history ends
 *   with the removal, and the other plugin's hook package and the user's server are untouched.
 *   Asked again, the answer is 404 `plugin_not_installed`.
 * - Given a member who is not the owner, the answer is 403 `owner_required` and nothing is
 *   removed.
 * - Given a plugin that has left the library, its hook package and MCP servers still go, but a
 *   Skill under a name it used to ship stays: there is no library entry to read Skill names from.
 * - Given a part that cannot be removed (its folder is read-only), it is reported in `failed`
 *   with the reason and every other part is still removed.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentStateDir, hooksDir, skillsDir } from "@prismshadow/penguin-core";
import type {
  AgentHooksResponse,
  AgentMcpServersResponse,
  AgentSkillsResponse,
  PluginUninstallResponse,
  WorkbenchInfo,
  WorkbenchVersion,
} from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { contentTable, writePrefixPackage } from "./plugin-fixtures.js";

const PROJECT = "owner_u-uninstall";
const HOST_KEY = "@prismshadow/penguin-server#WorkbenchHost";
const MAIN_KEY = "@prismshadow/penguin-server#WorkbenchMain";
const VERSION = "2026.11.05.1";

const skill = (name: string) =>
  `---\nname: ${name}\ndescription: Do ${name}.\nversion: ${VERSION}\n---\n\nBody.\n`;

/** A workbench that loads and answers one word (ES2022 only: the DOM types slow every compile). */
const WORKBENCH_SOURCE = `/// <reference no-default-lib="true" />
/// <reference lib="es2022" />
import type { WorkbenchPackage } from "@prismshadow/penguin-server/plugin";

export default {
  modules: {
    Workbench: {
      create() {
        return { api: { main: { async handle() { return { body: "kitboard" }; } } } };
      },
    },
  },
} satisfies WorkbenchPackage;
`;

/** `@acme/kit`: two Skills, a hook package, two MCP servers and a workbench. */
const KIT = {
  "package.json": JSON.stringify({ name: "@acme/kit", version: "1.0.0" }),
  "ifaces.json": contentTable("@acme/kit", {
    skills: ["kit-guide", "notes"],
    hooks: { version: VERSION, stop: [{ command: "stop.mjs" }] },
    mcpServers: [
      { name: "kit-api", config: { transport: "http", url: "https://kit.invalid/mcp" } },
      { name: "kit-local", config: { command: "node", args: ["server.mjs"] } },
    ],
    workbenches: ["kitboard"],
  }),
  "skills/kit-guide/SKILL.md": skill("kit-guide"),
  "skills/notes/SKILL.md": skill("notes"),
  "hooks/stop.mjs": "process.exit(0);\n",
  "workbenches/kitboard/package.json": JSON.stringify({
    name: "kitboard",
    version: "1.0.0",
    type: "module",
    penguin: {
      version: VERSION,
      modules: [
        {
          name: "Workbench",
          requires: { host: { iface: HOST_KEY, from: "Host" } },
          provides: { main: MAIN_KEY },
          contributes: {},
          children: [],
        },
      ],
    },
  }),
  "workbenches/kitboard/index.ts": WORKBENCH_SOURCE,
};

/** `@acme/notes`: a hook package only — named like kit's `notes` Skill, and not kit's. */
const NOTES = {
  "package.json": JSON.stringify({ name: "@acme/notes", version: "1.0.0" }),
  "ifaces.json": contentTable("@acme/notes", {
    hooks: { version: VERSION, stop: [{ command: "stop.mjs" }] },
  }),
  "hooks/stop.mjs": "process.exit(0);\n",
};

describe("uninstalling a plugin from an Agent", { timeout: 30_000 }, () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  let agents = 0;

  beforeAll(async () => {
    t = await createTestApp();
    owner = apiClient(t.app, (await provisionUser(t.app, "owner_u")).cookie);
    member = apiClient(t.app, (await provisionUser(t.app, "member_u")).cookie);
    const created = await owner.post("/api/projects", { projectId: PROJECT, name: "uninstall" });
    expect(created.status, await created.text()).toBe(201);
    expect(
      (await owner.post(`/api/projects/${PROJECT}/members`, { userId: "member_u" })).status,
    ).toBe(201);
    await writePrefixPackage(t.root, "@acme/kit", KIT);
    await writePrefixPackage(t.root, "@acme/notes", NOTES);
  });
  afterAll(async () => {
    await t.cleanup();
  });

  /**
   * A fresh Agent with `plugins` installed, after `before` ran on it; answers its route prefix
   * and id.
   */
  const agentWith = async (plugins: string[], before?: (base: string) => Promise<void>) => {
    agents += 1;
    const agentId = `agent_${agents}`;
    const made = await owner.post(`/api/projects/${PROJECT}/agents`, { agentId });
    expect(made.status, await made.text()).toBe(201);
    const base = `/api/projects/${PROJECT}/agents/${agentId}`;
    await before?.(base);
    if (plugins.length > 0) {
      const installed = await owner.post(`${base}/plugins`, { names: plugins });
      expect(installed.status, await installed.text()).toBe(201);
    }
    return { base, agentId };
  };
  const skillNames = async (base: string) =>
    ((await (await owner.get(`${base}/skills`)).json()) as AgentSkillsResponse).skills.map(
      (s) => s.name,
    );
  const hookNames = async (base: string) =>
    ((await (await owner.get(`${base}/hooks`)).json()) as AgentHooksResponse).hooks.map(
      (h) => h.name,
    );
  const serverNames = async (base: string) =>
    (
      (await (await owner.get(`${base}/mcp-servers`)).json()) as AgentMcpServersResponse
    ).servers.map((s) => s.name);

  it("removes every part the plugin put there and nothing else, and the workbench's history ends with the removal", async () => {
    // The user's own server comes first: an install appends after it.
    const mine = { name: "mine", config: { transport: "http", url: "https://mine.invalid/mcp" } };
    const { base } = await agentWith(["kit", "notes"], async (at) => {
      expect((await owner.put(`${at}/config`, { config: { mcpServers: [mine] } })).status).toBe(
        200,
      );
    });
    // The workbench loads once, so its first version is in the history.
    const listed = (await (await owner.get(`${base}/workbenches`)).json()) as {
      workbenches: WorkbenchInfo[];
    };
    expect(listed.workbenches.map((w) => [w.id, w.error])).toEqual([["kitboard", null]]);
    const history = async () =>
      (
        (await (await owner.get(`${base}/workbenches/kitboard/history`)).json()) as {
          versions: WorkbenchVersion[];
        }
      ).versions;
    expect(await history()).toHaveLength(1);

    const res = await owner.delete(`${base}/plugins/kit`);
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await res.json()) as PluginUninstallResponse).toEqual({
      removed: {
        workbenches: ["kitboard"],
        mcpServers: ["kit-api", "kit-local"],
        hooks: ["kit"],
        skills: ["kit-guide", "notes"],
      },
    });
    expect(await skillNames(base)).toEqual([]);
    expect(await hookNames(base)).toEqual(["notes"]);
    expect(await serverNames(base)).toEqual(["mine"]);
    expect(
      ((await (await owner.get(`${base}/workbenches`)).json()) as { workbenches: unknown[] })
        .workbenches,
    ).toEqual([]);
    // Removed the way a single removal is: a commit of its own, where the history walk stops.
    expect(await history()).toEqual([]);
    expect((await owner.get(`${base}/workbenches/kitboard/api/`)).status).toBe(404);

    const again = await owner.delete(`${base}/plugins/kit`);
    expect(again.status).toBe(404);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe(
      "plugin_not_installed",
    );
  });

  it("refuses a member who is not the owner and removes nothing", async () => {
    const { base } = await agentWith(["kit"]);
    const res = await member.delete(`${base}/plugins/kit`);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("owner_required");
    expect(await skillNames(base)).toEqual(["kit-guide", "notes"]);
    expect(await hookNames(base)).toEqual(["kit"]);
    expect(await serverNames(base)).toEqual(["kit-api", "kit-local"]);
  });

  it("takes a plugin that left the library by its records, but no Skill under a name it used to ship", async () => {
    const { base, agentId } = await agentWith([]);
    // What `gone` left behind when the admin removed it from the library: a hook package, an
    // MCP server carrying its name, and a Skill named after one it shipped.
    const hook = path.join(hooksDir(t.root, PROJECT, agentId), "gone");
    await fs.mkdir(hook, { recursive: true });
    await fs.writeFile(path.join(hook, "hooks.json"), JSON.stringify({ name: "gone", stop: [] }));
    const left = path.join(skillsDir(t.root, PROJECT, agentId), "gone-guide");
    await fs.mkdir(left, { recursive: true });
    await fs.writeFile(path.join(left, "SKILL.md"), skill("gone-guide"));
    const entry = {
      name: "gone-api",
      plugin: "gone",
      config: { transport: "http", url: "https://gone.invalid/mcp" },
    };
    expect((await owner.put(`${base}/config`, { config: { mcpServers: [entry] } })).status).toBe(
      200,
    );

    const res = await owner.delete(`${base}/plugins/gone`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      removed: { workbenches: [], mcpServers: ["gone-api"], hooks: ["gone"], skills: [] },
    });
    expect(await hookNames(base)).toEqual([]);
    expect(await serverNames(base)).toEqual([]);
    expect(await skillNames(base)).toEqual(["gone-guide"]);
  });

  // A read-only directory is what makes the removal fail, and neither Windows nor root honours one.
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "reports a part that cannot be removed and still removes the rest",
    async () => {
      const { base, agentId } = await agentWith(["kit"]);
      // Nothing in it can be deleted, hooks.json included.
      const hook = path.join(hooksDir(t.root, PROJECT, agentId), "kit");
      await fs.chmod(hook, 0o555);
      const res = await Promise.resolve(owner.delete(`${base}/plugins/kit`)).finally(() =>
        fs.chmod(hook, 0o755),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as PluginUninstallResponse;
      expect(body.removed).toEqual({
        workbenches: ["kitboard"],
        mcpServers: ["kit-api", "kit-local"],
        hooks: [],
        skills: ["kit-guide", "notes"],
      });
      expect(body.failed).toEqual([{ kind: "hook", name: "kit", error: expect.any(String) }]);
      expect(await hookNames(base)).toEqual(["kit"]);
      expect(await skillNames(base)).toEqual([]);
      await expect(
        fs.stat(path.join(agentStateDir(t.root, PROJECT, agentId), "workbenches", "kitboard")),
      ).rejects.toThrow();
    },
  );
});
