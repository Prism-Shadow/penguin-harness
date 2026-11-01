/**
 * Agent definitions as a plugin package contribution (agents/package.ts, and what the
 * plugin install surface does with them). The three rules under test (proposal: an Agent
 * may be a plugin, its package.json being optional; a package that is an Agent is
 * downloaded through the plugin channels; what follows the download is a COPY into the
 * Project — nothing executes):
 *
 *   - the definition is an `agent_state/` beside the package.json — no marker, no extra
 *     manifest — and the Agent's lived history (memory, traces, snapshots, workspaces,
 *     scratchpad, the vault) is not part of it;
 *   - installing copies that part into the Project, as data: byte-for-byte, named by the
 *     package's unscoped name, nothing run, no table written;
 *   - reinstalling updates the copy in place, and re-fills an Agent directory deleted by
 *     hand; a package with no definition is no Agent install.
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
  copyAgentDefinition,
  hasAgentDefinition,
  hasAgentDefinitionFiles,
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

const definition: Files = {
  "agent_state/skills/review/SKILL.md": skill("review", "reviews code"),
  "agent_state/system_config.yaml": "version: 1\n",
  "agent_state/AGENTS.md": "# guidance\n",
};

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

  it("a package carries an Agent definition when its agent_state/ holds content, and the lived history is not part of it", () => {
    const files = asFiles({
      "package.json": "{}",
      ...definition,
      // The parts an Agent's package never carries, wherever they sit.
      "agent_state/.vault.toml": 'TOKEN = "secret"\n',
      "agent_state/memory/user/MEMORY.md": "# memory\n",
      "agent_state/traces/t.jsonl": "{}\n",
      "agent_state/snapshots/s.tar.gz": "bytes",
      "agent_state/workspaces/w/state.json": "{}\n",
      "agent_state/scratchpad/s/note.md": "note\n",
      "traces/t.jsonl": "{}\n",
      "README.md": "not the definition\n",
    });
    expect(hasAgentDefinitionFiles(files)).toBe(true);
    for (const rel of Object.keys(definition)) {
      expect(agentDefinitionEntry(rel)).toBe(rel);
    }
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
    ]) {
      expect(agentDefinitionEntry(rel), rel).toBeNull();
    }
  });

  it("a directory with no agent_state/ carries no definition, and one with only lived history does not either", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-agent-def-"));
    try {
      expect(await hasAgentDefinition(root)).toBe(false);
      const state = path.join(root, "agent_state");
      await fs.mkdir(path.join(state, "memory"), { recursive: true });
      await fs.writeFile(path.join(state, "memory", "MEMORY.md"), "# memory\n");
      await fs.writeFile(path.join(state, ".vault.toml"), 'TOKEN = "secret"\n');
      expect(await hasAgentDefinition(root)).toBe(false);
      await fs.mkdir(path.join(state, "skills", "review"), { recursive: true });
      await fs.writeFile(path.join(state, "skills", "review", "SKILL.md"), skill("review", "r"));
      expect(await hasAgentDefinition(root)).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("installing copies the definition as data, named by the package's unscoped name — nothing else lands", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-agent-copy-"));
    try {
      const out = await copyAgentDefinition({
        root,
        projectId: "default_project",
        packageName: "@acme/reviewer",
        files: asFiles({
          "package.json": '{"name":"@acme/reviewer","version":"1.0.0"}',
          "skills/notes/SKILL.md": skill("notes", "the package's own plugin part"),
          ...definition,
          "agent_state/.vault.toml": 'TOKEN = "secret"\n',
          "agent_state/memory/user/MEMORY.md": "# memory\n",
          "agent_state/traces/t.jsonl": "{}\n",
        }),
      });
      expect(out.agentId).toBe("reviewer");
      const dir = path.join(root, "default_project", "agents", "reviewer");
      await expect(
        fs.readFile(path.join(dir, "agent_state", "skills", "review", "SKILL.md"), "utf8"),
      ).resolves.toBe(definition["agent_state/skills/review/SKILL.md"]);
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
          files: asFiles(definition),
        }),
      ).rejects.toThrow(/cannot name an Agent directory/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("reinstalling updates the copy in place: carried files are replaced, the rest is kept", async () => {
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
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("re-copying an installed package runs nothing: the package on disk is untouched, byte for byte", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-agent-reinstall-"));
    try {
      const dir = await installedPackage(root, "reviewer", {
        "package.json": JSON.stringify({ name: "reviewer", version: "1.0.0" }),
        ...definition,
        "postinstall.sh": "exit 1\n",
      });
      if (!(await hasAgentDefinition(dir))) throw new Error("expected a definition");
      const before = await packageFiles(dir);
      await copyAgentDefinition({
        root,
        projectId: "default_project",
        packageName: "reviewer",
        files: before,
      });
      await expect(
        fs.readFile(
          path.join(root, "default_project", "agents", "reviewer", "agent_state", "AGENTS.md"),
          "utf8",
        ),
      ).resolves.toBe("# guidance\n");
      expect(Object.fromEntries(before)).toEqual(Object.fromEntries(await packageFiles(dir)));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("an uploaded zip whose Agent definition is the whole package installs as a plugin package, and the definition is copied", async () => {
    const npm = fakeNpm();
    const admin = await boot(npm);
    const res = await admin.post("/api/projects/default_project/plugins/installed/archive", {
      dataBase64: Buffer.from(
        zip({
          "package.json": JSON.stringify({ name: "@acme/reviewer", version: "1.0.0" }),
          ...definition,
        }),
      ).toString("base64"),
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
    // listed for it (a definition alone loads nothing).
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

  it("a definition beside skills lands in both places: the library and the Project", async () => {
    const admin = await boot(fakeNpm());
    const res = await admin.post("/api/projects/default_project/plugins/installed/archive", {
      dataBase64: Buffer.from(
        zip({
          "package.json": JSON.stringify({ name: "@acme/notes", version: "1.0.0" }),
          "skills/notes/SKILL.md": skill("notes", "takes notes"),
          ...definition,
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

  it("a zip that is neither a plugin nor a carrier of a definition is refused", async () => {
    const admin = await boot(fakeNpm());
    const res = await admin.post("/api/projects/default_project/plugins/installed/archive", {
      dataBase64: Buffer.from(
        zip({
          "package.json": JSON.stringify({ name: "left-pad", version: "1.0.0" }),
          "index.js": "export {};\n",
        }),
      ).toString("base64"),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("plugin_archive_invalid");
    expect(body.error.message).toMatch(/Not a PenguinHarness plugin/);
  });

  it("an install whose package carries an Agent definition copies it, and lists nothing", async () => {
    const npm = fakeNpm();
    const files: Files = {
      "package.json": JSON.stringify({ name: "reviewer", version: "1.0.0" }),
      ...definition,
    };
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

  it("a package without a definition is refused on install, and taken back", async () => {
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

  it("a package zip parses with its definition part reported, whatever else the package carries", async () => {
    const archive = await parsePluginArchive(
      zip({
        "package.json": JSON.stringify({ name: "@acme/reviewer", version: "1.0.0" }),
        ...definition,
        "README.md": "readme\n",
      }),
    );
    expect(archive).toMatchObject({
      name: "@acme/reviewer",
      version: "1.0.0",
      library: false,
      modules: false,
      agent: true,
    });
    // The whole package is in the files; the copy drops the lived history (agents/package.ts).
    expect(archive.files.has("agent_state/AGENTS.md")).toBe(true);
    expect(archive.files.has("README.md")).toBe(true);
  });
});
