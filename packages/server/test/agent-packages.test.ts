/**
 * The Agent definition a plugin package contributes (`ifaces.json`), and what loading does
 * with it. The three rules under test (proposal: an Agent may be a plugin, the package
 * contributing the definition through its own module manifest; a package that is an Agent is
 * downloaded through the plugin channels; what follows the download is a COPY into the
 * Project — nothing executes):
 *
 *   - the contribution is the package's own module manifest — a module in its entry file
 *     whose generated table (`ifaces.json`) contributes to the agents mechanism's
 *     `definitions` slot; the copy reads that table without importing anything, and the
 *     definition's content is the `agent_state/` convention, minus the Agent's lived
 *     history (memory, traces, snapshots, workspaces, scratchpad, the vault);
 *   - the load that listing triggers copies the listed files into the Project, as data:
 *     named by the contribution's agentId, nothing run, no table written — an install apply,
 *     a push and a boot all pass through the same load, so a re-install updates the copy in
 *     place and a directory deleted by hand is re-filled;
 *   - a package whose table contributes nothing to the slot is no Agent package; an upload
 *     is refused when the package is a plugin by neither half.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { PLUGINS_FILE, loadPlugins } from "../src/plugin/loader.js";
import {
  agentDefinitionEntry,
  agentDefinitionsFromTable,
  copyAgentDefinition,
  AGENT_DEFINITIONS_SLOT,
  AGENT_STATE_DIR,
} from "../src/agents/package.js";
import { parsePluginArchive } from "../src/services/plugin-archive.js";
import { createTestApp, loginAdmin, apiClient } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const bytes = (value: string | Uint8Array) => (typeof value === "string" ? strToU8(value) : value);

const skill = (name: string, body: string) =>
  `---\nname: ${name}\ndescription: ${body}\n---\n\n# ${name}\n`;

/** The definition's file list, as the manifest's `agentState` carries it. */
const DEFINITION_FILES = [
  "agent_state/skills/review/SKILL.md",
  "agent_state/system_config.yaml",
  "agent_state/AGENTS.md",
];

/** The table a definition package's entry generates into ifaces.json: one module, one contribution. */
const agentTable = () =>
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
          [AGENT_DEFINITIONS_SLOT]: [
            {
              id: "agent.definition",
              agentId: "reviewer",
              name: "reviewer",
              agentState: DEFINITION_FILES,
            },
          ],
        },
        children: [],
      },
    },
    plugin: { modules: ["agent"], replaces: [] },
  });

/** The files of a definition package, as its directory holds them. */
const packageFilesOf = (name: string): Record<string, string> => ({
  "package.json": JSON.stringify({ name, version: "1.0.0", main: "./index.mjs" }),
  "index.mjs": "export default { modules: [] };\n",
  "ifaces.json": agentTable(),
  ...Object.fromEntries(
    DEFINITION_FILES.map((rel) =>
      rel === "agent_state/skills/review/SKILL.md"
        ? [rel, skill("review", "reviews code")]
        : rel === "agent_state/system_config.yaml"
          ? [rel, "version: 1\n"]
          : [rel, "# guidance\n"],
    ),
  ),
});

describe("agent definitions as plugin packages", () => {
  let root: string;

  const writePackage = async (name: string): Promise<string> => {
    const dir = path.join(root, "plugins", "node_modules", ...name.split("/"));
    for (const [rel, value] of Object.entries(packageFilesOf(name))) {
      await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
      await fs.writeFile(path.join(dir, rel), value, "utf8");
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

  it("the definition is read from the table the package's entry generates; a table without the slot's contribution reads as none", () => {
    const table = JSON.parse(agentTable());
    expect(agentDefinitionsFromTable(table)).toEqual([
      { agentId: "reviewer", name: "reviewer", files: DEFINITION_FILES },
    ]);
    // No table, no contribution to the slot, a missing or malformed half — each is none.
    expect(agentDefinitionsFromTable({})).toEqual([]);
    expect(agentDefinitionsFromTable({ modules: { agent: {} } })).toEqual([]);
    expect(
      agentDefinitionsFromTable({
        modules: { agent: { contributes: { [AGENT_DEFINITIONS_SLOT]: ["nope"] } } },
      }),
    ).toEqual([]);
    expect(
      agentDefinitionsFromTable({
        modules: { agent: { contributes: { [AGENT_DEFINITIONS_SLOT]: [{ id: "x" }] } } },
      }),
    ).toEqual([]);
    expect(
      agentDefinitionsFromTable({
        modules: {
          agent: {
            contributes: {
              [AGENT_DEFINITIONS_SLOT]: [{ id: "x", agentId: "not a name", agentState: [] }],
            },
          },
        },
      }),
    ).toEqual([]);
  });

  it("a definition entry is an agent_state/ file only, and the lived history is never part of it", () => {
    expect(agentDefinitionEntry("agent_state/skills/review/SKILL.md")).toBe(
      "agent_state/skills/review/SKILL.md",
    );
    expect(agentDefinitionEntry("agent_state/system_config.yaml")).toBe(
      "agent_state/system_config.yaml",
    );
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
      expect(agentDefinitionEntry(rel), rel).toBeNull();
    }
  });

  it("the copy lands under the contribution's agentId, carries the definition files, and nothing else", async () => {
    const target = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-agent-copy-"));
    try {
      const files = new Map(
        Object.entries(packageFilesOf("@acme/reviewer")).map(([k, v]) => [k, bytes(v)]),
      );
      files.set("agent_state/.vault.toml", bytes('TOKEN = "secret"\n'));
      files.set("agent_state/memory/user/MEMORY.md", bytes("# memory\n"));
      const copied = await copyAgentDefinition({
        root: target,
        projectId: "p1",
        definition: { agentId: "reviewer", name: "reviewer", files: DEFINITION_FILES },
        files,
      });
      expect(copied).toEqual(DEFINITION_FILES);
      const dir = path.join(target, "p1", "agents", "reviewer");
      await expect(
        fs.readFile(path.join(dir, "agent_state", "skills", "review", "SKILL.md"), "utf8"),
      ).resolves.toBe(skill("review", "reviews code"));
      await expect(
        fs.readFile(path.join(dir, "agent_state", "system_config.yaml"), "utf8"),
      ).resolves.toBe("version: 1\n");
      // The lived history is not copied, and nothing outside the Agent's directory lands.
      await expect(fs.access(path.join(dir, "agent_state", ".vault.toml"))).rejects.toThrow();
      await expect(fs.access(path.join(dir, "agent_state", "memory"))).rejects.toThrow();
      expect(await fs.readdir(path.join(target, "p1", "agents"))).toEqual(["reviewer"]);
    } finally {
      await fs.rm(target, { recursive: true, force: true });
    }
  });

  it("reinstalling updates the copy in place: carried files are replaced, the rest is kept", async () => {
    const target = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-agent-update-"));
    try {
      const dir = path.join(target, "p1", "agents", "reviewer", "agent_state");
      await fs.mkdir(path.join(dir, "skills", "old"), { recursive: true });
      await fs.writeFile(path.join(dir, "system_config.yaml"), "version: 7\n");
      await fs.writeFile(path.join(dir, "skills", "old", "SKILL.md"), skill("old", "kept"));
      const files = new Map(
        Object.entries({
          "agent_state/system_config.yaml": "version: 8\n",
          "agent_state/skills/review/SKILL.md": skill("review", "reviews code"),
        }).map(([k, v]) => [k, bytes(v)]),
      );
      await copyAgentDefinition({
        root: target,
        projectId: "p1",
        definition: {
          agentId: "reviewer",
          files: ["agent_state/system_config.yaml", "agent_state/skills/review/SKILL.md"],
        },
        files,
      });
      await expect(fs.readFile(path.join(dir, "system_config.yaml"), "utf8")).resolves.toBe(
        "version: 8\n",
      );
      await expect(
        fs.readFile(path.join(dir, "skills", "review", "SKILL.md"), "utf8"),
      ).resolves.toBe(skill("review", "reviews code"));
      await expect(fs.readFile(path.join(dir, "skills", "old", "SKILL.md"), "utf8")).resolves.toBe(
        skill("old", "kept"),
      );
    } finally {
      await fs.rm(target, { recursive: true, force: true });
    }
  });

  it("the load that listing triggers copies the definition into the Project; a re-load after a hand deletion re-fills it", async () => {
    const specifier = await writePackage("@acme/reviewer");
    await writeConfig([specifier]);
    const first = await loadPlugins(root);
    expect(first.failed.size).toBe(0);
    await expect(
      fs.readFile(path.join(root, "p1", "agents", "reviewer", "agent_state", "AGENTS.md"), "utf8"),
    ).resolves.toBe("# guidance\n");
    // The Agent's lived history stays out of the copy.
    await expect(
      fs.access(path.join(root, "p1", "agents", "reviewer", "agent_state", "memory")),
    ).rejects.toThrow();

    // A directory deleted by hand is re-filled by the next load of the same package.
    await fs.rm(path.join(root, "p1", "agents", "reviewer"), { recursive: true, force: true });
    await loadPlugins(root);
    await expect(
      fs.readFile(path.join(root, "p1", "agents", "reviewer", "agent_state", "AGENTS.md"), "utf8"),
    ).resolves.toBe("# guidance\n");
  });

  it("only the Projects that list the package get the copy", async () => {
    await writePackage("@acme/reviewer");
    await writeConfig(["@acme/reviewer"], "p1");
    await writeConfig([], "p2");
    await loadPlugins(root);
    await expect(
      fs.access(path.join(root, "p1", "agents", "reviewer", "agent_state", "AGENTS.md")),
    ).resolves.toBeUndefined();
    await expect(fs.access(path.join(root, "p2", "agents"))).rejects.toThrow();
  });

  it("a table that contributes nothing to the slot copies nothing", async () => {
    const dir = path.join(root, "plugins", "node_modules", "@acme", "bare");
    await fs.mkdir(path.join(dir, "agent_state"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "@acme/bare", version: "1.0.0" }),
      "utf8",
    );
    await fs.writeFile(
      path.join(dir, "ifaces.json"),
      JSON.stringify({
        ifaces: {},
        types: {},
        modules: { util: { name: "util", kind: "component" } },
        plugin: { modules: ["util"], replaces: [] },
      }),
      "utf8",
    );
    await fs.writeFile(path.join(dir, AGENT_STATE_DIR, "AGENTS.md"), "# guidance\n", "utf8");
    await writeConfig(["@acme/bare"]);
    const result = await loadPlugins(root);
    expect(result.loaded.map((e) => e.specifier)).toContain("@acme/bare");
    await expect(fs.access(path.join(root, "p1", "agents"))).rejects.toThrow();
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

  it("a zip whose package contributes a definition installs through the plugin channel — the table travels, the copy follows the load", async () => {
    const admin = await boot();
    const zipFiles: Record<string, string | Uint8Array> = {
      "package.json": JSON.stringify({ name: "@acme/reviewer", version: "1.0.0" }),
      "index.mjs": "export default { modules: [] };\n",
      "ifaces.json": agentTable(),
      ...Object.fromEntries(DEFINITION_FILES.map((rel) => [rel, "# guidance\n"])),
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
      "package.json": JSON.stringify({ name: "@acme/reviewer", version: "1.0.0" }),
      "index.mjs": "export default { modules: [] };\n",
      "ifaces.json": agentTable(),
      ...Object.fromEntries(DEFINITION_FILES.map((rel) => [rel, "# guidance\n"])),
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
    // The whole package is in the files; the copy drops the lived history (agents/package.ts).
    expect(archive.files.has("agent_state/AGENTS.md")).toBe(true);
  });
});
