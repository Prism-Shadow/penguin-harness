/**
 * The Agent definition a plugin package contributes (`ifaces.json`), and what the install
 * surface does with it. The three rules under test (proposal: an Agent may be a plugin, the
 * package contributing the definition through its own module manifest; a package that is an
 * Agent is downloaded through the plugin channels; what follows the download is a COPY into
 * the Project — nothing executes):
 *
 *   - the contribution is the package's own module manifest — a module in its entry file
 *     whose generated table (`ifaces.json`) contributes to the agents mechanism's
 *     `definitions` slot; the server reads that table without importing anything, and the
 *     definition's content is the `agent_state/` convention, minus the Agent's lived
 *     history (memory, traces, snapshots, workspaces, scratchpad, the vault);
 *   - installing copies that part into the Project, as data: named by the package's unscoped
 *     name, nothing run, no table written;
 *   - reinstalling updates the copy in place, and re-fills an Agent directory deleted by
 *     hand; a package that contributes no definition is no Agent install.
 */
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { strFromU8, strToU8, zipSync } from "fflate";
import type { PluginInstallOutcome } from "../src/api/types.js";
import { PluginInstallError } from "../src/plugin/install.js";
import {
  agentDefinitionEntry,
  agentDefinitionsFromFiles,
  agentDefinitionsFromTable,
  copyAgentDefinition,
  AGENT_DEFINITIONS_SLOT,
  packageFiles,
} from "../src/agents/package.js";
import { parsePluginArchive } from "../src/services/plugin-archive.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

type Files = Record<string, string | Uint8Array>;

const bytes = (value: string | Uint8Array) => (typeof value === "string" ? strToU8(value) : value);

const zip = (files: Files) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, bytes(v)])));

const skill = (name: string, body: string) =>
  `---\nname: ${name}\ndescription: ${body}\n---\n\n# ${name}\n`;

const asFiles = (files: Files) => new Map(Object.entries(files).map(([k, v]) => [k, bytes(v)]));

/**
 * The table an Agent-definition package's entry file generates into `ifaces.json`: one
 * module whose manifest contributes the definition to the agents mechanism's slot. Written
 * the way `gen-ifaces` emits it — the manifest is data, read without importing anything.
 */
const agentTable = (definition: { name: string; agentState: string[] }): string =>
  JSON.stringify({
    ifaces: {},
    types: {},
    modules: {
      agent: {
        name: "agent",
        kind: "component",
        requires: {},
        provides: {},
        contributes: { [AGENT_DEFINITIONS_SLOT]: [definition] },
        children: [],
      },
    },
    plugin: { modules: ["agent"], replaces: [] },
  });

/** A package that contributes the Agent definition: entry file, its table, and the definition files. */
const registered = (name: string): Files => ({
  "package.json": JSON.stringify({ name, version: "1.0.0", main: "index.js" }),
  "index.js": `export class Agent { contributes = { "${AGENT_DEFINITIONS_SLOT}": [{ id: "agent.definition", name: "reviewer" }] } }\n`,
  "ifaces.json": agentTable({
    name: "reviewer",
    agentState: [
      "agent_state/skills/review/SKILL.md",
      "agent_state/system_config.yaml",
      "agent_state/AGENTS.md",
    ],
  }),
  "agent_state/skills/review/SKILL.md": skill("review", "reviews code"),
  "agent_state/system_config.yaml": "version: 1\n",
  "agent_state/AGENTS.md": "# guidance\n",
});

/** An npm-installed package as a directory in the prefix, with the prefix's own manifest. */
const installedPackage = async (root: string, name: string, files: Files): Promise<string> => {
  const dir = path.join(root, "plugins", "node_modules", ...name.split("/"));
  for (const [rel, value] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await fs.writeFile(path.join(dir, rel), bytes(value));
  }
  return dir;
};

/**
 * npm as a stub: whatever its links map holds under a source is what that source installs.
 * A link holds one package; a registry name falls back to the package filed under it.
 */
const fakeNpm = () => {
  const removed: string[] = [];
  const links = new Map<string, Files>();
  return {
    removed,
    links,
    install: async (root: string, source: string) => {
      const held = links.get(source);
      if (held === undefined) throw new PluginInstallError(`404 Not Found - GET ${source}`);
      const manifest = JSON.parse(strFromU8(bytes(held["package.json"]!))) as { name: string };
      await installedPackage(root, manifest.name, held);
      return { name: manifest.name, version: "1.0.0" };
    },
    installFiles: async (root: string, files: Record<string, Uint8Array>) => {
      const manifest = JSON.parse(strFromU8(files["package.json"]!)) as { name: string };
      await installedPackage(root, manifest.name, files as Files);
      return { name: manifest.name, version: "1.0.0" };
    },
    remove: async (_root: string, name: string) => {
      removed.push(name);
    },
  };
};

describe("agent definitions as plugin packages", () => {
  let t: TestApp;
  const apps: TestApp[] = [];

  const boot = async (packages?: ReturnType<typeof fakeNpm>) => {
    t = await createTestApp(packages === undefined ? {} : { pluginPackages: packages });
    apps.push(t);
    return apiClient(t.app, (await loginAdmin(t.app)).cookie);
  };

  afterEach(async () => {
    for (const app of apps.splice(0)) await app.cleanup();
  });

  it("the definition is read from the table the package's entry generates: the slot's contribution is the whole registration", async () => {
    const definitions = agentDefinitionsFromFiles(
      asFiles(registered("@acme/reviewer")),
      "reviewer",
    );
    expect(definitions).toEqual([
      {
        agentId: "reviewer",
        name: "reviewer",
        files: [
          "agent_state/skills/review/SKILL.md",
          "agent_state/system_config.yaml",
          "agent_state/AGENTS.md",
        ],
      },
    ]);
    // A package without a table, or whose table carries no contribution to the slot,
    // contributes no definition — and a malformed entry reads as none.
    expect(agentDefinitionsFromFiles(asFiles({ "package.json": "{}" }), "x")).toEqual([]);
    expect(agentDefinitionsFromTable({}, "x")).toEqual([]);
    expect(agentDefinitionsFromTable({ modules: { agent: {} } }, "x")).toEqual([]);
    expect(
      agentDefinitionsFromTable(
        { modules: { agent: { contributes: { [AGENT_DEFINITIONS_SLOT]: ["nope"] } } } },
        "x",
      ),
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

  it("installing copies the contributed definition as data, named by the package's unscoped name — nothing else lands", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-agent-copy-"));
    try {
      const out = await copyAgentDefinition({
        root,
        projectId: "default_project",
        packageName: "@acme/reviewer",
        files: asFiles({
          "package.json": JSON.stringify({ name: "@acme/reviewer", main: "index.js" }),
          "skills/notes/SKILL.md": skill("notes", "the package's own plugin part"),
          ...registered("reviewer"),
          "agent_state/.vault.toml": 'TOKEN = "secret"\n',
          "agent_state/memory/user/MEMORY.md": "# memory\n",
          "agent_state/traces/t.jsonl": "{}\n",
        }),
        definition: {
          name: "reviewer",
          agentState: [
            "agent_state/skills/review/SKILL.md",
            "agent_state/system_config.yaml",
            "agent_state/AGENTS.md",
          ],
        },
      });
      expect(out.agentId).toBe("reviewer");
      const dir = path.join(root, "default_project", "agents", "reviewer");
      await expect(
        fs.readFile(path.join(dir, "agent_state", "skills", "review", "SKILL.md"), "utf8"),
      ).resolves.toBe(registered("reviewer")["agent_state/skills/review/SKILL.md"]);
      await expect(
        fs.readFile(path.join(dir, "agent_state", "system_config.yaml"), "utf8"),
      ).resolves.toBe("version: 1\n");
      // The lived history is not in the package, and nothing outside the Agent's directory
      // is written: the copy is the whole install.
      await expect(fs.access(path.join(dir, "agent_state", ".vault.toml"))).rejects.toThrow();
      await expect(fs.access(path.join(dir, "agent_state", "memory"))).rejects.toThrow();
      await expect(fs.access(path.join(dir, "agent_state", "traces"))).rejects.toThrow();
      expect(await fs.readdir(path.join(root, "default_project", "agents"))).toEqual(["reviewer"]);
      expect(out.copied).toEqual([
        "agent_state/skills/review/SKILL.md",
        "agent_state/system_config.yaml",
        "agent_state/AGENTS.md",
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("a package name whose unscoped part cannot name an Agent directory is refused", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-agent-name-"));
    try {
      await expect(
        copyAgentDefinition({
          root,
          projectId: "default_project",
          packageName: "@acme/not a name",
          files: asFiles(registered("reviewer")),
          definition: { name: "reviewer", agentState: ["agent_state/AGENTS.md"] },
        }),
      ).rejects.toThrow(/cannot name an Agent directory/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("reinstalling updates the copy in place: carried files are replaced, the rest is kept — and the package on disk is untouched, byte for byte", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-agent-update-"));
    try {
      const dir = path.join(root, "default_project", "agents", "reviewer", "agent_state");
      await fs.mkdir(path.join(dir, "skills", "old"), { recursive: true });
      await fs.writeFile(path.join(dir, "system_config.yaml"), "version: 7\n");
      await fs.writeFile(path.join(dir, "skills", "old", "SKILL.md"), skill("old", "kept"));
      await copyAgentDefinition({
        root,
        projectId: "default_project",
        packageName: "reviewer",
        files: asFiles({
          "agent_state/system_config.yaml": "version: 8\n",
          "agent_state/skills/review/SKILL.md": skill("review", "reviews code"),
        }),
        definition: {
          name: "reviewer",
          agentState: ["agent_state/system_config.yaml", "agent_state/skills/review/SKILL.md"],
        },
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

      // The copy reads the package and writes the Agent: nothing writes back, nothing runs.
      const prefix = await installedPackage(root, "reviewer", {
        ...registered("reviewer"),
        "postinstall.sh": "exit 1\n",
      });
      const before = await packageFiles(prefix);
      await copyAgentDefinition({
        root,
        projectId: "default_project",
        packageName: "reviewer",
        files: before,
        definition: {
          name: "reviewer",
          agentState: [
            "agent_state/skills/review/SKILL.md",
            "agent_state/system_config.yaml",
            "agent_state/AGENTS.md",
          ],
        },
      });
      expect(Object.fromEntries(before)).toEqual(Object.fromEntries(await packageFiles(prefix)));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("an uploaded zip that contributes an Agent definition installs as a plugin package, and the definition is copied", async () => {
    const npm = fakeNpm();
    const admin = await boot(npm);
    const res = await admin.post("/api/projects/default_project/plugins/installed/archive", {
      dataBase64: Buffer.from(zip(registered("@acme/reviewer"))).toString("base64"),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { installed?: PluginInstallOutcome };
    expect(body.installed).toMatchObject({
      name: "@acme/reviewer",
      library: false,
      agent: { agentId: "reviewer" },
    });
    expect(body.installed?.agent?.copied).toEqual([
      "agent_state/skills/review/SKILL.md",
      "agent_state/system_config.yaml",
      "agent_state/AGENTS.md",
    ]);
    // The package is installed the plugin way; the copy landed in the Project; nothing is
    // listed for it (a definition contributes nothing that loads).
    await expect(
      fs.readFile(
        path.join(t.root, "default_project", "agents", "reviewer", "agent_state", "AGENTS.md"),
        "utf8",
      ),
    ).resolves.toBe("# guidance\n");
    await expect(
      fs.access(path.join(t.root, "plugins", "node_modules", "@acme", "reviewer", "package.json")),
    ).resolves.toBeUndefined();
    const list = (await (
      await admin.get("/api/projects/default_project/plugins/installed")
    ).json()) as { plugins: { specifier: string }[] };
    expect(list.plugins).toEqual([]);
  });

  it("a contribution beside skills lands in both places: the library and the Project", async () => {
    const admin = await boot(fakeNpm());
    const res = await admin.post("/api/projects/default_project/plugins/installed/archive", {
      dataBase64: Buffer.from(
        zip({
          ...registered("@acme/notes"),
          "skills/notes/SKILL.md": skill("notes", "takes notes"),
        }),
      ).toString("base64"),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { installed?: PluginInstallOutcome };
    expect(body.installed).toMatchObject({
      name: "@acme/notes",
      library: true,
      agent: { agentId: "notes" },
    });
    await expect(
      fs.readFile(
        path.join(t.root, "default_project", "agents", "notes", "agent_state", "AGENTS.md"),
        "utf8",
      ),
    ).resolves.toBe("# guidance\n");
  });

  it("an ifaces.json that contributes nothing to the slot is no registration, and a package with neither any contribution nor a table is refused", async () => {
    const admin = await boot(fakeNpm());
    const bare = await admin.post("/api/projects/default_project/plugins/installed/archive", {
      dataBase64: Buffer.from(
        zip({
          "package.json": JSON.stringify({ name: "@acme/bare", version: "1.0.0" }),
          "index.js": "export {};\n",
          // A table whose modules contribute nothing to the definitions slot: the module
          // load is the surface that would use it — the install surface reads contributions.
          "ifaces.json": JSON.stringify({
            ifaces: {},
            types: {},
            modules: { util: { name: "util", kind: "component" } },
            plugin: { modules: ["util"], replaces: [] },
          }),
          "agent_state/AGENTS.md": "# guidance\n",
        }),
      ).toString("base64"),
    });
    // The server does not scan packages for parts: without the manifest's contribution this
    // is not an Agent contribution, and nothing else makes it a plugin.
    expect(bare.status).toBe(400);
    const body = (await bare.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("plugin_archive_invalid");
    expect(body.error.message).toMatch(/Not a PenguinHarness plugin/);
  });

  it("an install whose package contributes an Agent definition copies it, and lists nothing", async () => {
    const npm = fakeNpm();
    const files = registered("reviewer");
    npm.links.set("https://example.com/reviewer-1.0.0.tgz", files);
    npm.links.set("reviewer", files);
    const admin = await boot(npm);

    const res = await admin.post("/api/projects/default_project/plugins/installed", {
      specifier: "https://example.com/reviewer-1.0.0.tgz",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { installed?: PluginInstallOutcome };
    expect(body.installed).toMatchObject({
      name: "reviewer",
      library: false,
      agent: { agentId: "reviewer" },
    });
    await expect(
      fs.readFile(
        path.join(t.root, "default_project", "agents", "reviewer", "agent_state", "AGENTS.md"),
        "utf8",
      ),
    ).resolves.toBe("# guidance\n");
    // The definition is a contribution, not a server module: nothing is listed for it.
    const config = await fs.readFile(
      path.join(t.root, "default_project", ".project_config.toml"),
      "utf8",
    );
    expect(config).not.toContain("reviewer");

    // A directory deleted by hand is re-filled by the next install of the same package.
    await fs.rm(path.join(t.root, "default_project", "agents", "reviewer"), {
      recursive: true,
      force: true,
    });
    const again = await admin.post("/api/projects/default_project/plugins/installed", {
      specifier: "reviewer",
    });
    expect(again.status).toBe(200);
    await expect(
      fs.readFile(
        path.join(t.root, "default_project", "agents", "reviewer", "agent_state", "AGENTS.md"),
        "utf8",
      ),
    ).resolves.toBe("# guidance\n");
  });

  it("a package that contributes no definition is refused on install, and taken back", async () => {
    const npm = fakeNpm();
    npm.links.set("https://example.com/left-pad-1.0.0.tgz", {
      "package.json": JSON.stringify({ name: "left-pad", version: "1.0.0" }),
      "index.js": "export {};\n",
    });
    const admin = await boot(npm);
    const res = await admin.post("/api/projects/default_project/plugins/installed", {
      specifier: "https://example.com/left-pad-1.0.0.tgz",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("not_a_plugin");
    expect(body.error.message).toMatch(/install scripts had already run/);
    expect(npm.removed).toEqual(["left-pad"]);
  });

  it("a zip parses the contribution its table holds; the whole package travels as its files", async () => {
    const archive = await parsePluginArchive(zip(registered("@acme/reviewer")));
    expect(archive).toMatchObject({
      name: "@acme/reviewer",
      version: "1.0.0",
      library: false,
      modules: false,
      agent: true,
    });
    // The whole package is in the files; the copy drops the lived history (agents/package.ts).
    expect(archive.files.has("agent_state/AGENTS.md")).toBe(true);
  });

  it("a contribution without any definition content installs, copies nothing, and the answer carries no Agent", async () => {
    const admin = await boot(fakeNpm());
    const res = await admin.post("/api/projects/default_project/plugins/installed/archive", {
      dataBase64: Buffer.from(
        zip({
          "package.json": JSON.stringify({ name: "@acme/empty", version: "1.0.0" }),
          "index.js": "export {};\n",
          "ifaces.json": agentTable({ name: "empty", agentState: [] }),
        }),
      ).toString("base64"),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { installed?: PluginInstallOutcome };
    // The contribution holds, but the package's agent_state/ carries nothing copyable: the
    // answer does not invent an Agent (the install surface never lies about a copy).
    expect(body.installed?.agent).toBeUndefined();
  });
});
