/**
 * The Agent definition a plugin package contributes, and how its copy is consumed.
 *
 * The package contributes the definition the way it contributes a sandbox backend: a
 * module in its entry file contributes to the agents mechanism's `definitions` slot —
 * the static half names the Agent (the id the copy installs under), and the code half,
 * bound with `@Bind`, is the contributor copying its OWN `agent_state/` into the target.
 * The service consumes the contributions at assembly the way the sandbox consumes its
 * backends. The install surface keeps no Agent verb of its own: a package is a plugin
 * by its library parts or its table.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { PLUGINS_FILE, loadPlugins } from "../src/plugin/loader.js";
import {
  agentTargetDir,
  copyAgentState,
  AGENT_DEFINITIONS_SLOT,
  AGENT_STATE_DIR,
} from "../src/agents/package.js";
import { parsePluginArchive } from "../src/services/plugin-archive.js";
import { decorators, lower } from "./plugin-fixtures.js";
import { createTestApp, loginAdmin, apiClient } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const bytes = (value: string | Uint8Array) => (typeof value === "string" ? strToU8(value) : value);

const zipOf = (files: Record<string, string | Uint8Array>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, bytes(v)])));

const skill = (name: string, body: string) =>
  `---\nname: ${name}\ndescription: ${body}\n---\n\n# ${name}\n`;

/** The table the generator emits beside the module a definition package's entry declares. */
const reviewerTable = () =>
  JSON.stringify({
    ifaces: { "@acme/reviewer#Agent": { name: "Agent", methods: {} } },
    types: {},
    modules: {
      Agent: {
        name: "Agent",
        kind: "component",
        requires: {},
        provides: { Agent: "@acme/reviewer#Agent" },
        contributes: {
          [AGENT_DEFINITIONS_SLOT]: [{ id: "agent.definition", agentId: "reviewer" }],
        },
        children: [],
      },
    },
    plugin: { modules: ["Agent"], replaces: [] },
  });

const reviewerIndex = () =>
  lower(`import { Component, Bind } from ${JSON.stringify(decorators)};
         @Component({
           contributes: { "AgentConfigService.definitions": [{ id: "agent.definition", agentId: "reviewer" }] },
         })
         export class Agent {
           @Bind("agent.definition") copy() {
             throw new Error("probe: the copy must be replaced");
           }
         }
         export default { modules: [Agent] };`);

describe("agent definitions as plugin packages", () => {
  let root: string;

  /** The files of a definition package's directory, before the entry and its table go in. */
  const filesOf = (name: string): Record<string, string> => ({
    "package.json": JSON.stringify({ name, version: "1.0.0", main: "./index.mjs" }),
    "agent_state/skills/review/SKILL.md": skill("review", "reviews code"),
    "agent_state/system_config.yaml": "version: 1\n",
    "agent_state/AGENTS.md": "# guidance\n",
  });

  const writeDefinitionPackage = async (name: string): Promise<string> => {
    const dir = path.join(root, "plugins", "node_modules", ...name.split("/"));
    for (const [rel, value] of Object.entries(filesOf(name))) {
      await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
      await fs.writeFile(path.join(dir, rel), value, "utf8");
    }
    await fs.writeFile(path.join(dir, "index.mjs"), reviewerIndex(), "utf8");
    await fs.writeFile(path.join(dir, "ifaces.json"), reviewerTable(), "utf8");
    return dir;
  };

  const writeConfig = async (plugins: string[], projectId = "p1"): Promise<void> => {
    await fs.mkdir(path.join(root, projectId), { recursive: true });
    await fs.writeFile(
      path.join(root, projectId, PLUGINS_FILE),
      `models = []\n[plugins]\n${plugins.map((s) => `${JSON.stringify(s)} = "*"`).join("\n")}\n`,
      "utf8",
    );
  };

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-agent-def-"));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("the copy lands the package's agent_state/ whole, and a reinstall replaces what it carries and touches nothing else", async () => {
    const target = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-agent-copy-"));
    try {
      const from = path.join(target, "pkg", AGENT_STATE_DIR);
      await fs.mkdir(path.join(from, "skills", "review"), { recursive: true });
      await fs.writeFile(
        path.join(from, "skills", "review", "SKILL.md"),
        skill("review", "reviews code"),
      );
      await fs.writeFile(path.join(from, "system_config.yaml"), "version: 1\n");
      await fs.writeFile(path.join(from, "AGENTS.md"), "# guidance\n");

      const toAgent = agentTargetDir(target, "p1", "reviewer");
      await copyAgentState({ fromDir: from, toAgentDir: toAgent });
      await expect(
        fs.readFile(path.join(toAgent, "agent_state", "system_config.yaml"), "utf8"),
      ).resolves.toBe("version: 1\n");
      await expect(
        fs.readFile(path.join(toAgent, "agent_state", "skills", "review", "SKILL.md"), "utf8"),
      ).resolves.toBe(skill("review", "reviews code"));
      await expect(
        fs.readFile(path.join(toAgent, "agent_state", "AGENTS.md"), "utf8"),
      ).resolves.toBe("# guidance\n");
      // The source is untouched: the copy is data, nothing writes back.
      await expect(fs.readFile(path.join(from, "AGENTS.md"), "utf8")).resolves.toBe("# guidance\n");

      // A reinstall replaces what the definition carries and touches nothing else — a
      // file the definition carries no more is not removed.
      await fs.writeFile(path.join(from, "system_config.yaml"), "version: 8\n");
      await fs.mkdir(path.join(toAgent, "agent_state", "skills", "old"), { recursive: true });
      await fs.writeFile(
        path.join(toAgent, "agent_state", "skills", "old", "SKILL.md"),
        skill("old", "kept"),
      );
      await copyAgentState({ fromDir: from, toAgentDir: toAgent });
      await expect(
        fs.readFile(path.join(toAgent, "agent_state", "system_config.yaml"), "utf8"),
      ).resolves.toBe("version: 8\n");
      await expect(
        fs.readFile(path.join(toAgent, "agent_state", "skills", "old", "SKILL.md"), "utf8"),
      ).resolves.toBe(skill("old", "kept"));
    } finally {
      await fs.rm(target, { recursive: true, force: true });
    }
  });

  it("a package whose table contributes a definition loads; a package without one loads as the plain plugin it is", async () => {
    await writeDefinitionPackage("@acme/reviewer");
    const bare = path.join(root, "plugins", "node_modules", "@acme", "bare");
    for (const [rel, value] of Object.entries(filesOf("@acme/bare"))) {
      await fs.mkdir(path.dirname(path.join(bare, rel)), { recursive: true });
      await fs.writeFile(path.join(bare, rel), value, "utf8");
    }
    await fs.writeFile(path.join(bare, "index.mjs"), "export default { modules: [] };\n", "utf8");
    await writeConfig(["@acme/reviewer", "@acme/bare"]);
    const result = await loadPlugins(root);
    expect(result.failed.size).toBe(0);
    expect(result.loaded.map((e) => e.specifier)).toEqual(["@acme/reviewer", "@acme/bare"]);
  });
});

describe("agent definition packages on the install surface", () => {
  let t: TestApp;
  const apps: TestApp[] = [];

  const boot = async () => {
    t = await createTestApp({});
    apps.push(t);
    return apiClient(t.app, (await loginAdmin(t.app)).cookie);
  };

  afterEach(async () => {
    for (const app of apps.splice(0)) await app.cleanup();
  });

  const reviewerZip = (extra: Record<string, string | Uint8Array> = {}) =>
    zipOf({
      "package.json": JSON.stringify({
        name: "@acme/reviewer",
        version: "1.0.0",
        main: "./index.mjs",
      }),
      "index.mjs": "export default { modules: [] };\n",
      "ifaces.json": reviewerTable(),
      ...extra,
    });

  it("a zip whose package carries a table installs through the plugin channel", async () => {
    const admin = await boot();
    const res = await admin.post("/api/projects/default_project/plugins/installed/archive", {
      dataBase64: Buffer.from(reviewerZip({ "agent_state/AGENTS.md": "# guidance\n" })).toString(
        "base64",
      ),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { installed?: { name: string; library: boolean } };
    expect(body.installed).toMatchObject({ name: "@acme/reviewer", library: false });
    await expect(
      fs.access(path.join(t.root, "plugins", "node_modules", "@acme", "reviewer", "ifaces.json")),
    ).resolves.toBeUndefined();
  });

  it("an archive is a plugin by the table it holds, the whole package traveling as its files; a bare agent_state/ is not a plugin, whatever else it carries", async () => {
    const archive = await parsePluginArchive(
      reviewerZip({ "agent_state/AGENTS.md": "# guidance\n" }),
    );
    expect(archive).toMatchObject({
      name: "@acme/reviewer",
      version: "1.0.0",
      library: false,
      modules: true,
    });
    expect(archive.files.has("agent_state/AGENTS.md")).toBe(true);
    await expect(
      parsePluginArchive(
        zipOf({
          "package.json": JSON.stringify({ name: "@acme/bare", version: "1.0.0" }),
          "agent_state/AGENTS.md": "# guidance\n",
        }),
      ),
    ).rejects.toThrow(/Not a PenguinHarness plugin/);
  });
});
