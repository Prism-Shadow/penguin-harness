/**
 * Behavior tests for plugin loading: plugins are CONFIGURATION read from the data
 * root, resolved against the installation, and every failure is per-entry and
 * non-fatal — the capability a plugin would have provided stays unavailable rather
 * than the boot failing.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { IFACES_FILE, PLUGINS_FILE, loadPlugins, readPluginList } from "../src/plugin/loader.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "penguin-plugins-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeConfig(value: unknown): Promise<void> {
  await writeFile(path.join(root, PLUGINS_FILE), JSON.stringify(value), "utf8");
}

/** A plugin module on disk, imported by absolute specifier (the dev-checkout path). */
async function writePluginModule(name: string, body: string): Promise<string> {
  const dir = path.join(root, "mods");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${name}.mjs`);
  await writeFile(file, body, "utf8");
  return file;
}

describe("plugin list", () => {
  it("no config file means no plugins — the default deployment shape, not an error", async () => {
    expect(await readPluginList(root)).toEqual([]);
    expect(await loadPlugins(root)).toEqual({ loaded: [], failed: new Map() });
  });

  it("reads the configured specifiers in order", async () => {
    await writeConfig({ plugins: ["a", "b"] });
    expect(await readPluginList(root)).toEqual(["a", "b"]);
  });

  it("a malformed config fails the load rather than presenting as empty", async () => {
    await writeFile(path.join(root, PLUGINS_FILE), "{not json", "utf8");
    await expect(readPluginList(root)).rejects.toThrow(/not valid JSON/);
    // A CONFIG-level failure propagates: booting with an empty plugin set would present
    // as healthy while silently dropping every capability the config asked for.
    await expect(loadPlugins(root)).rejects.toThrow(/not valid JSON/);
  });

  it("a config that exists but cannot be read is an error, not 'no plugins'", async () => {
    // A directory in its place stands in for every non-ENOENT read failure (EACCES,
    // EPERM, EISDIR, an I/O fault): something was configured and cannot be honored.
    await mkdir(path.join(root, PLUGINS_FILE));
    await expect(readPluginList(root)).rejects.toThrow(/exists but could not be read/);
    await expect(loadPlugins(root)).rejects.toThrow(/exists but could not be read/);
  });

  it("a config with the wrong shape names the shape it wanted", async () => {
    await writeConfig({ plugins: [1, 2] });
    await expect(readPluginList(root)).rejects.toThrow(/package specifier/);
  });
});

describe("plugin loading", () => {
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
