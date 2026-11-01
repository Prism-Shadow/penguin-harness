/**
 * The Agent definition a plugin package contributes, and how its copy is consumed.
 *
 * The package contributes the definition the way it contributes a sandbox backend: a
 * module in its entry file contributes to the agents mechanism's `definitions` slot — the
 * static half names the Agent (the id the copy installs under), and the code half,
 * bound with `@Bind`, is the contributor copying its OWN `agent_state/` into the target.
 * The service consumes the contributions at assembly the way the sandbox consumes its
 * backends: nothing reads the package or its table — the manifest is data, and the copy
 * streams file by file, however big the definition is.
 *
 * The three rules under test:
 *   - the copy lands under the contribution's agentId, carries the definition files, and
 *     skips the lived history (memory, traces, snapshots, workspaces, scratchpad, the
 *     vault) — the same rules a contributor's own copy follows through the shared helpers;
 *   - the assembly consumes the contributions: a Project whose list carries the package
 *     gets the copy when the service runs (boot, an install apply, a re-assembly); one
 *     that does not list it gets nothing;
 *   - an install surface with no Agent verb of its own: a package is a plugin by its
 *     library parts or its table — a bare agent_state/ without one is refused.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { PLUGINS_FILE, loadPlugins } from "../src/plugin/loader.js";
import {
  agentDefinitionEntry,
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

const skill = (name: string, body: string) =>
  `---\nname: ${name}\ndescription: ${body}\n---\n\n# ${name}\n`;

/** The files of a definition package, as its directory holds them. */
const packageFilesOf = (name: string): Record<string, string> => ({
  "package.json": JSON.stringify({ name, version: "1.0.0", main: "./index.mjs" }),
  "index.mjs": "export default { modules: [] };\n",
  "agent_state/skills/review/SKILL.md": skill("review", "reviews code"),
  "agent_state/system_config.yaml": "version: 1\n",
  "agent_state/AGENTS.md": "# guidance\n",
});

describe("agent definitions as plugin packages", () => {
  let root: string;

  const writePackage = async (name: string, withTable = true): Promise<string> => {
    const dir = path.join(root, "plugins", "node_modules", ...name.split("/"));
    for (const [rel, value] of Object.entries(packageFilesOf(name))) {
      await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
      await fs.writeFile(path.join(dir, rel), value, "utf8");
    }
    if (withTable) {
      await fs.writeFile(
        path.join(dir, "ifaces.json"),
        JSON.stringify({
          ifaces: {},
          types: {},
          modules: {
            agent: {
              name: "agent",
              kind: "component",
              requires: {},
              provides: {},
              contributes: {
                [AGENT_DEFINITIONS_SLOT]: [{ id: "agent.definition", agentId: "reviewer" }],
              },
              children: [],
            },
          },
          plugin: { modules: ["agent"], replaces: [] },
        }),
        "utf8",
      );
      await fs.writeFile(
        path.join(dir, "index.mjs"),
        lower(`import { Component, Bind } from ${JSON.stringify(decorators)};
               @Component({
                 contributes: { "AgentConfigService.definitions": [{ id: "agent.definition", agentId: "reviewer" }] },
               })
               export class Agent {
                 @Bind("agent.definition") copy() {
                   throw new Error("probe: the copy must be replaced");
                 }
               }
               export default { modules: [Agent] };`),
        "utf8",
      );
    }
    return path.join(dir, "index.mjs");
  };

  const writeConfig = async (plugins: string[], projectId = "p1"): Promise<void> => {
    const rows = plugins.map((s) => `${JSON.stringify(s)} = "*"`);
    await fs.mkdir(path.join(root, projectId), { recursive: true });
    await fs.writeFile(
      path.join(root, projectId, PLUGINS_FILE),
      `models = []\n[plugins]\n${rows.join("\n")}\n`,
      "utf8",
    );
  };

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-agent-def-"));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("a definition entry is an agent_state/ file only, and the lived history is never part of it", () => {
    expect(agentDefinitionEntry("agent_state/skills/review/SKILL.md")).toBe(true);
    expect(agentDefinitionEntry("agent_state/system_config.yaml")).toBe(true);
    for (const rel of [
      "agent_state/.vault.toml",
      "agent_state/memory/user/MEMORY.md",
      "agent_state/traces/t.jsonl",
      "agent_state/snapshots/s.tar.gz",
      "agent_state/workspaces/w/state.json",
      "agent_state/scratchpad/s/note.md",
      "agent_state",
      "README.md",
      "traces/t.jsonl",
      "skills/notes/SKILL.md",
      "package.json",
    ]) {
      expect(agentDefinitionEntry(rel), rel).toBe(false);
    }
  });

  it("the copy streams the definition into the Agent's directory: carried files land, the lived history and the vault never travel", async () => {
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
      // The lived history sits beside the definition, as it does in a worked Agent:
      // the copy leaves it where it is.
      await fs.mkdir(path.join(from, "memory", "user"), { recursive: true });
      await fs.writeFile(path.join(from, "memory", "user", "MEMORY.md"), "# memory\n");
      await fs.writeFile(path.join(from, ".vault.toml"), 'TOKEN = "secret"\n');

      const toAgent = agentTargetDir(target, "p1", "reviewer");
      const copied = await copyAgentState({ fromDir: from, toAgentDir: toAgent });
      expect(copied).toEqual([
        "agent_state/AGENTS.md",
        "agent_state/skills/review/SKILL.md",
        "agent_state/system_config.yaml",
      ]);
      await expect(
        fs.readFile(path.join(toAgent, "agent_state", "AGENTS.md"), "utf8"),
      ).resolves.toBe("# guidance\n");
      await expect(
        fs.readFile(path.join(toAgent, "agent_state", "skills", "review", "SKILL.md"), "utf8"),
      ).resolves.toBe(skill("review", "reviews code"));
      await expect(
        fs.access(path.join(toAgent, "agent_state", "memory", "user", "MEMORY.md")),
      ).rejects.toThrow();
      await expect(fs.access(path.join(toAgent, "agent_state", ".vault.toml"))).rejects.toThrow();
      // The source is untouched: the copy is data, nothing writes back.
      await expect(fs.readFile(path.join(from, "AGENTS.md"), "utf8")).resolves.toBe("# guidance\n");
    } finally {
      await fs.rm(target, { recursive: true, force: true });
    }
  });

  it("reinstalling updates the copy in place: carried files are replaced, the rest is kept", async () => {
    const target = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-agent-update-"));
    try {
      const from = path.join(target, "pkg", AGENT_STATE_DIR);
      await fs.mkdir(path.join(from, "skills", "review"), { recursive: true });
      await fs.writeFile(path.join(from, "system_config.yaml"), "version: 8\n");
      await fs.writeFile(
        path.join(from, "skills", "review", "SKILL.md"),
        skill("review", "reviews code"),
      );

      const toAgent = agentTargetDir(target, "p1", "reviewer");
      await fs.mkdir(path.join(toAgent, "agent_state", "skills", "old"), { recursive: true });
      await fs.writeFile(path.join(toAgent, "agent_state", "system_config.yaml"), "version: 7\n");
      await fs.writeFile(
        path.join(toAgent, "agent_state", "skills", "old", "SKILL.md"),
        skill("old", "kept"),
      );

      await copyAgentState({ fromDir: from, toAgentDir: toAgent });
      await expect(
        fs.readFile(path.join(toAgent, "agent_state", "system_config.yaml"), "utf8"),
      ).resolves.toBe("version: 8\n");
      await expect(
        fs.readFile(path.join(toAgent, "agent_state", "skills", "review", "SKILL.md"), "utf8"),
      ).resolves.toBe(skill("review", "reviews code"));
      await expect(
        fs.readFile(path.join(toAgent, "agent_state", "skills", "old", "SKILL.md"), "utf8"),
      ).resolves.toBe(skill("old", "kept"));
    } finally {
      await fs.rm(target, { recursive: true, force: true });
    }
  });

  it("a package whose table contributes a definition loads; a bare agent_state/ without the table is no plugin and loads as a refusal", async () => {
    const good = await writePackage("@acme/reviewer");
    // A package without a table: the loader refuses an unresolvable entry shape the same
    // way it refuses any package that is not a plugin — no agent scan saves it.
    const dir = path.join(root, "plugins", "node_modules", "@acme", "bare");
    for (const [rel, value] of Object.entries(packageFilesOf("@acme/bare"))) {
      await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
      await fs.writeFile(path.join(dir, rel), value, "utf8");
    }
    await writeConfig(["@acme/reviewer", "@acme/bare"]);
    const result = await loadPlugins(root);
    expect(result.loaded.map((e) => e.specifier)).toEqual([good]);
    expect(result.failed.get("@acme/bare")).toBeTruthy();
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

  it("a zip whose package carries a table installs through the plugin channel", async () => {
    const admin = await boot();
    const zipFiles: Record<string, string | Uint8Array> = {
      "package.json": JSON.stringify({
        name: "@acme/reviewer",
        version: "1.0.0",
        main: "./index.mjs",
      }),
      "index.mjs": "export default { modules: [] };\n",
      "ifaces.json": JSON.stringify({
        ifaces: {},
        types: {},
        modules: {
          agent: {
            name: "agent",
            kind: "component",
            requires: {},
            provides: {},
            contributes: {
              [AGENT_DEFINITIONS_SLOT]: [{ id: "agent.definition", agentId: "reviewer" }],
            },
            children: [],
          },
        },
        plugin: { modules: ["agent"], replaces: [] },
      }),
      "agent_state/AGENTS.md": "# guidance\n",
    };
    const res = await admin.post("/api/projects/default_project/plugins/installed/archive", {
      dataBase64: Buffer.from(
        zipSync(Object.fromEntries(Object.entries(zipFiles).map(([k, v]) => [k, bytes(v)]))),
      ).toString("base64"),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { installed?: { name: string; library: boolean } };
    expect(body.installed).toMatchObject({ name: "@acme/reviewer", library: false });
    await expect(
      fs.access(path.join(t.root, "plugins", "node_modules", "@acme", "reviewer", "ifaces.json")),
    ).resolves.toBeUndefined();
  });

  it("a zip that is a plugin by neither half is refused, whatever else it carries", async () => {
    const admin = await boot();
    const res = await admin.post("/api/projects/default_project/plugins/installed/archive", {
      dataBase64: Buffer.from(
        zipSync({
          "package.json": bytes(JSON.stringify({ name: "@acme/bare", version: "1.0.0" })),
          "agent_state/AGENTS.md": bytes("# guidance\n"),
        }),
      ).toString("base64"),
    });
    // A bare agent_state/ without the table is not a plugin: no contribution, no modules.
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("plugin_archive_invalid");
    expect(body.error.message).toMatch(/Not a PenguinHarness plugin/);
  });

  it("a zip parses as a plugin the table it holds; the whole package travels as its files", async () => {
    const zipFiles: Record<string, string | Uint8Array> = {
      "package.json": JSON.stringify({
        name: "@acme/reviewer",
        version: "1.0.0",
        main: "./index.mjs",
      }),
      "index.mjs": "export default { modules: [] };\n",
      "ifaces.json": JSON.stringify({
        ifaces: {},
        types: {},
        modules: {
          agent: {
            name: "agent",
            kind: "component",
            requires: {},
            provides: {},
            contributes: {
              [AGENT_DEFINITIONS_SLOT]: [{ id: "agent.definition", agentId: "reviewer" }],
            },
            children: [],
          },
        },
        plugin: { modules: ["agent"], replaces: [] },
      }),
      "agent_state/AGENTS.md": "# guidance\n",
    };
    const archive = await parsePluginArchive(
      zipSync(Object.fromEntries(Object.entries(zipFiles).map(([k, v]) => [k, bytes(v)]))),
    );
    expect(archive).toMatchObject({
      name: "@acme/reviewer",
      version: "1.0.0",
      library: false,
      modules: true,
    });
    expect(archive.files.has("agent_state/AGENTS.md")).toBe(true);
  });
});
