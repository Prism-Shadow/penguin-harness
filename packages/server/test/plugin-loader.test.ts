/**
 * Behavior tests for plugin loading: plugins are CONFIGURATION read from the data
 * root, resolved against the installation, and every failure is per-entry and
 * non-fatal — the capability a plugin would have provided stays unavailable rather
 * than the boot failing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import {
  IFACES_FILE,
  PLUGINS_FILE,
  committedAssetsDir,
  discoverBuiltinPlugins,
  loadPlugins,
  pluginBases,
  readPluginClosure,
  readProjectPluginList,
  listProjectIds,
} from "../src/plugin/loader.js";
import { writeClassPackage } from "./plugin-fixtures.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "penguin-plugins-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A Project asking for these plugins: its `[plugins]` table is what the closure is read from. */
async function writeConfig(value: { plugins?: string[] }, projectId = "p1"): Promise<void> {
  const rows = (value.plugins ?? []).map((s) => `${JSON.stringify(s)} = "*"`);
  await writeProject(projectId, `models = []\n[plugins]\n${rows.join("\n")}\n`);
}

/** Raw config text, for the malformed cases. */
async function writeProject(projectId: string, text: string): Promise<void> {
  await mkdir(path.join(root, projectId), { recursive: true });
  await writeFile(path.join(root, projectId, PLUGINS_FILE), text, "utf8");
}

/** A plugin module on disk, imported by absolute specifier (the dev-checkout path). */
async function writePluginModule(name: string, body: string): Promise<string> {
  const dir = path.join(root, "mods");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${name}.mjs`);
  await writeFile(file, body, "utf8");
  return file;
}

/**
 * The decorators, as a plugin's bundle would carry them — here imported from this
 * checkout's built SDK by file URL, since a package under a temp dir resolves nothing.
 */
const decorators = new URL("../../core/dist/plugin/index.js", import.meta.url).href;

/** Plugin source as a plugin author writes it, lowered the way its build would lower it. */
function lower(source: string): string {
  return ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
}

describe("plugin list", () => {
  it("no Project means no plugins — the default deployment shape, not an error", async () => {
    expect(await readPluginClosure(root)).toEqual([]);
    expect(await loadPlugins(root)).toEqual({ loaded: [], failed: new Map() });
  });

  it("reads the configured specifiers in order", async () => {
    await writeConfig({ plugins: ["a", "b"] });
    expect(await readProjectPluginList(root, "p1")).toEqual(["a", "b"]);
    expect(await readPluginClosure(root)).toEqual(["a", "b"]);
  });

  it("the closure is the union over Projects, each specifier once", async () => {
    // Loading is per process — one module tree — so what a deployment runs is what any of
    // its Projects asked for, and a plugin two Projects both want is still one entry.
    await writeConfig({ plugins: ["a", "shared"] }, "p1");
    await writeConfig({ plugins: ["shared", "b"] }, "p2");
    expect(await listProjectIds(root)).toEqual(["p1", "p2"]);
    expect(await readPluginClosure(root)).toEqual(["a", "shared", "b"]);
  });

  it("a directory that is not a Project is not read as one", async () => {
    await mkdir(path.join(root, "hmr"), { recursive: true });
    await writeConfig({ plugins: ["a"] }, "p1");
    expect(await listProjectIds(root)).toEqual(["p1"]);
  });

  it("a Project whose config will not parse is skipped, not fatal for the rest", async () => {
    // Its models are just as unreadable; the deployment still has to come up for everyone else.
    await writeProject("broken", "[plugins]\nx = [oops\n");
    await writeConfig({ plugins: ["a"] }, "p1");
    expect(await readProjectPluginList(root, "broken")).toEqual([]);
    expect(await readPluginClosure(root)).toEqual(["a"]);
  });

  it("a config that exists but cannot be read is skipped like one that will not parse", async () => {
    // A directory in its place stands in for every non-ENOENT read failure (EACCES,
    // EPERM, EISDIR, an I/O fault). It is that Project's fault to report (its list view
    // does), not a reason to keep every other Project's deployment from coming up.
    await writeProject("p2", 'models = []\n[plugins]\n"@acme/two" = "*"\n');
    await mkdir(path.join(root, "p1", PLUGINS_FILE), { recursive: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(readProjectPluginList(root, "p1")).resolves.toEqual([]);
      expect(await readPluginClosure(root)).toEqual(["@acme/two"]);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/p1: .*could not be read/));
    } finally {
      warn.mockRestore();
    }
  });

  it("entries that are not requirements are dropped, not fatal", async () => {
    // Leniency on purpose: a typo in this table must not take the Project's models with it.
    await writeProject(
      "p1",
      'models = []\n[plugins]\nok = "*"\npinned = "1.2.3"\ntabled = { version = "2" }\nbad = 7\nworse = { version = 3 }\n',
    );
    expect(await readProjectPluginList(root, "p1")).toEqual(["ok", "pinned", "tabled"]);
  });

  it("the list form this key once had is not read: such a Project asks for none", async () => {
    // Deliberately no compatibility (PRFC-0010): a table replaced the list before release,
    // and a file still carrying the list starts with no plugins until it is written again.
    await writeProject("p1", 'plugins = ["@acme/old"]\nmodels = []\n');
    expect(await readProjectPluginList(root, "p1")).toEqual([]);
  });
});

describe("plugin loading", () => {
  /** The table the plugin's build would generate: one component, contributing one provider. */
  const oneModule = {
    ifaces: {
      "@acme/penguin-plugin-thing#Thing": { name: "Thing", methods: {}, slots: {} },
    },
    types: {},
    modules: {
      Thing: {
        name: "Thing",
        requires: {},
        provides: { Thing: "@acme/penguin-plugin-thing#Thing" },
        contributes: {
          "SandboxModule.providers": [
            { id: "thing.provider", name: "thing", dimensions: ["fs-write"] },
          ],
        },
        children: [],
      },
    },
  };
  const thingClass = `
    import { Bind, Component } from ${JSON.stringify(decorators)};
    @Component({ contributes: { "SandboxModule.providers": [{ id: "thing.provider", name: "thing", dimensions: ["fs-write"] }] } })
    export class Thing {
      @Bind("thing.provider") provider!: unknown;
      setup() { this.provider = { confine() { throw new Error("no"); } }; }
    }`;

  /**
   * A package on disk: its package.json, the generated table beside it, and an index.mjs
   * default export (`null` table = a package that ships no modules, or was never built).
   */
  async function writePackage(name: string, table: unknown | null, index: string): Promise<string> {
    const dir = path.join(root, "node_modules", ...name.split("/"));
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name, main: "./index.mjs" }),
      "utf8",
    );
    if (table !== null) await writeFile(path.join(dir, IFACES_FILE), JSON.stringify(table), "utf8");
    await writeFile(path.join(dir, "index.mjs"), lower(index), "utf8");
    return path.join(dir, "index.mjs");
  }

  it("boots the classes the default export names, each against its manifest in the package's table", async () => {
    const file = await writePackage(
      "@acme/penguin-plugin-thing",
      oneModule,
      `${thingClass}
       export default { modules: [Thing] };`,
    );
    await writeConfig({ plugins: [file] });
    const result = await loadPlugins(root);
    expect(result.failed.size).toBe(0);
    expect(result.loaded).toHaveLength(1);
    const entry = result.loaded[0]!;
    expect(entry.specifier).toBe(file);
    expect(entry.modules.map((m) => m.manifest.name)).toEqual(["Thing"]);
    expect(entry.modules[0]!.manifest.contributes["SandboxModule.providers"]?.[0]?.id).toBe(
      "thing.provider",
    );
    expect(entry.ifaces?.ifaces["@acme/penguin-plugin-thing#Thing"]).toBeDefined();
    // The class is the code half: its @Bind field is the contribution's implementation.
    const instance = await entry.modules[0]!.create(
      { use: {}, contributions: {}, resources: {} as never, effect: () => {} },
      {},
    );
    expect(typeof (instance.bind?.["thing.provider"] as { confine: unknown }).confine).toBe(
      "function",
    );
  });

  it("an unresolvable specifier is skipped with its reason, not fatal", async () => {
    const good = await writePackage(
      "@acme/good",
      oneModule,
      `${thingClass}
       export default { modules: [Thing] };`,
    );
    await writeConfig({ plugins: ["@nope/definitely-not-installed", good] });
    const result = await loadPlugins(root);
    // The good one still loads: failure is per entry.
    expect(result.loaded.map((entry) => entry.specifier)).toEqual([good]);
    expect(result.failed.get("@nope/definitely-not-installed")).toBeTruthy();
  });

  it("a default export that is not a list of classes is a load failure that says so", async () => {
    const file = await writePackage(
      "@acme/half",
      oneModule,
      "export default { modules: { Thing: { create() {} } } };",
    );
    await writeConfig({ plugins: [file] });
    const result = await loadPlugins(root);
    expect(result.loaded).toEqual([]);
    expect(result.failed.get(file)).toMatch(/not a Plugin/);
  });

  it("a class the table does not carry is a stale build, named as such", async () => {
    const file = await writePackage(
      "@acme/extra",
      oneModule,
      `${thingClass}
       import { Component } from ${JSON.stringify(decorators)};
       @Component() export class Ghost {}
       export default { modules: [Thing, Ghost] };`,
    );
    await writeConfig({ plugins: [file] });
    const result = await loadPlugins(root);
    expect(result.failed.get(file)).toMatch(/Ghost: not in the generated manifest table/);
  });

  it("classes under `replaces` are paired the same way, and land in the plugin's replaces", async () => {
    const file = await writePackage(
      "@acme/penguin-plugin-thing",
      {
        ...oneModule,
        modules: {
          ...oneModule.modules,
          MemoryService: {
            ...oneModule.modules.Thing,
            name: "MemoryService",
            provides: {},
            contributes: {},
          },
        },
      },
      `${thingClass}
       import { Module } from ${JSON.stringify(decorators)};
       @Module() export class MemoryService {}
       export default { modules: [Thing], replaces: [MemoryService] };`,
    );
    await writeConfig({ plugins: [file] });
    const result = await loadPlugins(root);
    expect(result.failed.size).toBe(0);
    const entry = result.loaded[0]!;
    expect(entry.modules.map((m) => m.manifest.name)).toEqual(["Thing"]);
    expect(entry.replaces.map((m) => m.manifest.name)).toEqual(["MemoryService"]);
  });

  it("a package without a table ships no modules — a plugin is a plugin by being listed", async () => {
    const file = await writePackage("@acme/skills-only", null, "export default { modules: [] };");
    await writeConfig({ plugins: [file] });
    const result = await loadPlugins(root);
    expect(result.failed.size).toBe(0);
    expect(result.loaded[0]!.modules).toEqual([]);
  });

  it("a package that names module classes but ships no table was never built, and says so", async () => {
    const file = await writePackage(
      "@acme/unbuilt",
      null,
      `${thingClass}
       export default { modules: [Thing] };`,
    );
    await writeConfig({ plugins: [file] });
    const result = await loadPlugins(root);
    expect(result.failed.get(file)).toMatch(/ifaces\.json is missing — build the package/);
  });

  it("a malformed manifest in the table is a load failure naming the module", async () => {
    const file = await writePackage(
      "@acme/bad-table",
      { ifaces: {}, types: {}, modules: { Thing: { contributes: {} } } },
      "export default { modules: [] };",
    );
    await writeConfig({ plugins: [file] });
    const result = await loadPlugins(root);
    expect(result.failed.get(file)).toMatch(/ifaces\.json#modules\.Thing/);
  });
});

describe("builtin plugins", () => {
  /** A plugin package under a prefix's node_modules, the shape scripts/build-plugins.mjs ships. */
  async function writeBuiltin(prefix: string, name: string, moduleName: string): Promise<void> {
    const dir = path.join(prefix, "node_modules", ...name.split("/"));
    await mkdir(dir, { recursive: true });
    // The prefix manifest names what was shipped, the way build-plugins writes it.
    const manifestFile = path.join(prefix, "package.json");
    const manifest = JSON.parse(
      await readFile(manifestFile, "utf8").catch(() => '{"name":"prefix","private":true}'),
    ) as { dependencies?: Record<string, string> };
    manifest.dependencies = { ...manifest.dependencies, [name]: "0.0.0" };
    await writeFile(manifestFile, JSON.stringify(manifest), "utf8");
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name, main: "./index.js", type: "module" }),
      "utf8",
    );
    await writeFile(
      path.join(dir, IFACES_FILE),
      JSON.stringify({
        ifaces: {},
        types: {},
        modules: {
          [moduleName]: {
            name: moduleName,
            requires: {},
            provides: {},
            contributes: {},
            children: [],
          },
        },
        plugin: { modules: [moduleName], replaces: [] },
      }),
      "utf8",
    );
    await writeFile(
      path.join(dir, "index.js"),
      lower(`import { Module } from ${JSON.stringify(decorators)};
             @Module() export class ${moduleName} {}
             export default { modules: [${moduleName}] };`),
      "utf8",
    );
  }

  it("lists what the build ships, scoped and unscoped, and not what the root's own prefix holds", async () => {
    const assets = path.join(root, "hmr", "store", "assets", "abc");
    await writeBuiltin(path.join(assets, "plugins"), "@acme/penguin-plugin-one", "One");
    await writeBuiltin(path.join(assets, "plugins"), "plain-plugin", "Plain");
    // The operator's own prefix is not builtin: what it holds loads only when listed.
    await writeBuiltin(path.join(root, "plugins"), "@acme/installed", "Installed");
    const bases = pluginBases(root, assets);
    expect(bases[0]).toMatchObject({ builtin: false });
    expect(bases[1]).toMatchObject({ builtin: true });
    expect(await discoverBuiltinPlugins(bases)).toEqual([
      "@acme/penguin-plugin-one",
      "plain-plugin",
    ]);
  });

  it("does not load a shipped plugin until it is listed, and then loads it from the shipped prefix", async () => {
    const assetsRel = path.join("store", "assets", "abc");
    const assets = path.join(root, "hmr", assetsRel);
    await writeBuiltin(path.join(assets, "plugins"), "@acme/penguin-plugin-one", "One");
    await mkdir(path.join(root, "hmr"), { recursive: true });
    // harness.json is what names the committed assets; the loader reads it without a host.
    await writeFile(
      path.join(root, "hmr", "harness.json"),
      JSON.stringify({ assets: { dir: assetsRel.split(path.sep).join("/") } }),
      "utf8",
    );
    // Shipped, and nothing lists it: available is not installed.
    await writeConfig({ plugins: [] });
    expect((await loadPlugins(root)).loaded).toEqual([]);

    // Listed: it loads, resolved from the assets the push carried — no npm, nothing under
    // <root>/plugins.
    await writeConfig({ plugins: ["@acme/penguin-plugin-one"] });
    const result = await loadPlugins(root);
    expect([...result.failed.entries()]).toEqual([]);
    expect(result.loaded.map((p) => p.specifier)).toEqual(["@acme/penguin-plugin-one"]);
    expect(result.loaded[0]!.modules.map((m) => m.manifest.name)).toEqual(["One"]);
  });

  it("resolves a package through its exports' import condition, as npm shipped it", async () => {
    // The sandbox backends declare `exports: { ".": { types, import: "./dist/index.js" } }`
    // and no `require` condition; the loader reads the entry an importer would, not what
    // require.resolve would (it has none).
    const assets = path.join(root, "hmr", "store", "assets", "abc");
    const dir = path.join(assets, "plugins", "node_modules", "@acme", "exported");
    await mkdir(path.join(assets, "plugins"), { recursive: true });
    await writeFile(
      path.join(assets, "plugins", "package.json"),
      '{"name":"prefix","private":true}',
    );
    await writeClassPackage(dir, {
      name: "@acme/exported",
      module: "Exported",
      main: "./dist/index.js",
      exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
    });
    await writeConfig({ plugins: ["@acme/exported"] });
    const result = await loadPlugins(root, assets);
    expect([...result.failed.entries()]).toEqual([]);
    expect(result.loaded[0]!.file).toBe(path.join(dir, "dist", "index.js"));
  });

  it("reads a committed assets dir from harness.json, or null without one", async () => {
    expect(await committedAssetsDir(root)).toBeNull();
    await mkdir(path.join(root, "hmr"), { recursive: true });
    await writeFile(
      path.join(root, "hmr", "harness.json"),
      JSON.stringify({ assets: { dir: "store/assets/x" } }),
    );
    expect(await committedAssetsDir(root)).toBe(path.join(root, "hmr", "store/assets/x"));
  });
});
