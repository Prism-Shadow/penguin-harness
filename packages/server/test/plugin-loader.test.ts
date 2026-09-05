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
import { PLUGINS_FILE, loadPlugins, readPluginList } from "../src/plugin/loader.js";

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
  /** A package on disk: package.json#penguin.modules plus an index.mjs default export. */
  async function writePackage(name: string, penguin: unknown, index: string): Promise<string> {
    const dir = path.join(root, "node_modules", ...name.split("/"));
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name, main: "./index.mjs", penguin }),
      "utf8",
    );
    await writeFile(path.join(dir, "index.mjs"), index, "utf8");
    return path.join(dir, "index.mjs");
  }
  const oneModule = {
    modules: [
      {
        name: "thing",
        contributes: {
          "SandboxModule.providers": [
            { id: "thing.provider", name: "thing", dimensions: ["fs-write"] },
          ],
        },
      },
    ],
  };

  it("pairs each manifest in package.json#penguin.modules with the default export's module of that name", async () => {
    const file = await writePackage(
      "@acme/penguin-plugin-thing",
      oneModule,
      'export default { modules: { thing: { create: () => ({ api: {}, bind: { "thing.provider": { confine() { throw new Error("no"); } } } }) } } };',
    );
    await writeConfig({ plugins: [file] });
    const result = await loadPlugins(root);
    expect(result.failed.size).toBe(0);
    expect(result.loaded).toHaveLength(1);
    const entry = result.loaded[0]!;
    expect(entry.specifier).toBe(file);
    expect(entry.modules.map((m) => m.manifest.name)).toEqual(["thing"]);
    expect(entry.modules[0]!.manifest.contributes["SandboxModule.providers"]?.[0]?.id).toBe(
      "thing.provider",
    );
    expect(typeof entry.modules[0]!.create).toBe("function");
  });

  it("the manifest is the half that was checked: the code half cannot replace it", async () => {
    const file = await writePackage(
      "@acme/penguin-plugin-sneaky",
      oneModule,
      'export default { modules: { thing: { manifest: { name: "thing", contributes: {} }, create: () => ({ api: {} }) } } };',
    );
    await writeConfig({ plugins: [file] });
    const result = await loadPlugins(root);
    expect(result.failed.size).toBe(0);
    const manifest = result.loaded[0]!.modules[0]!.manifest;
    expect(manifest.contributes["SandboxModule.providers"]?.[0]?.id).toBe("thing.provider");
  });

  it("a manifest's children become nested definitions, and only the roots join the platform", async () => {
    const file = await writePackage(
      "@acme/penguin-plugin-family",
      {
        modules: [
          { name: "parent", children: ["child"] },
          { name: "child", contributes: {} },
        ],
      },
      "export default { modules: { parent: { create: () => ({ api: {} }) }, child: { create: () => ({ api: {} }) } } };",
    );
    await writeConfig({ plugins: [file] });
    const result = await loadPlugins(root);
    expect(result.failed.size).toBe(0);
    const roots = result.loaded[0]!.modules;
    expect(roots.map((m) => m.manifest.name)).toEqual(["parent"]);
    expect(roots[0]!.children?.map((m) => m.manifest.name)).toEqual(["child"]);
  });

  it("a declared child the package does not define, or claimed by two parents, is a load failure", async () => {
    const orphan = await writePackage(
      "@acme/penguin-plugin-orphan",
      { modules: [{ name: "parent", children: ["ghost"] }] },
      "export default { modules: { parent: { create: () => ({ api: {} }) } } };",
    );
    const twice = await writePackage(
      "@acme/penguin-plugin-twice",
      {
        modules: [{ name: "a", children: ["c"] }, { name: "b", children: ["c"] }, { name: "c" }],
      },
      "export default { modules: { a: { create: () => ({ api: {} }) }, b: { create: () => ({ api: {} }) }, c: { create: () => ({ api: {} }) } } };",
    );
    await writeConfig({ plugins: [orphan, twice] });
    const result = await loadPlugins(root);
    expect(result.loaded).toEqual([]);
    expect(result.failed.get(orphan)).toMatch(
      /declares child 'ghost', which the package does not define/,
    );
    expect(result.failed.get(twice)).toMatch(/'c' is a child of both 'a' and 'b'/);
  });

  it("an unresolvable specifier is skipped with its reason, not fatal", async () => {
    const good = await writePackage(
      "@acme/good",
      oneModule,
      "export default { modules: { thing: { create: () => ({ api: {} }) } } };",
    );
    await writeConfig({ plugins: ["@nope/definitely-not-installed", good] });
    const result = await loadPlugins(root);
    // The good one still loads: failure is per entry.
    expect(result.loaded.map((entry) => entry.specifier)).toEqual([good]);
    expect(result.failed.get("@nope/definitely-not-installed")).toBeTruthy();
  });

  it("a module the manifest names but the code does not provide is a load failure that says so", async () => {
    const file = await writePackage("@acme/half", oneModule, "export default { modules: {} };");
    await writeConfig({ plugins: [file] });
    const result = await loadPlugins(root);
    expect(result.loaded).toEqual([]);
    expect(result.failed.get(file)).toMatch(/names module 'thing'.*no create\(\)/);
  });

  it("a module the code provides but the manifest does not declare is refused too", async () => {
    const file = await writePackage(
      "@acme/extra",
      oneModule,
      "export default { modules: { thing: { create: () => ({ api: {} }) }, ghost: { create: () => ({ api: {} }) } } };",
    );
    await writeConfig({ plugins: [file] });
    const result = await loadPlugins(root);
    expect(result.failed.get(file)).toMatch(/module 'ghost' that .* does not declare/);
  });

  it("a package without package.json#penguin is not a plugin, and says so", async () => {
    const file = await writePluginModule("plain", "export default { modules: {} };");
    await writeConfig({ plugins: [file] });
    const result = await loadPlugins(root);
    expect(result.loaded).toEqual([]);
    expect(result.failed.get(file)).toMatch(/not a plugin package/);
  });

  it("a malformed manifest entry is a load failure naming the entry", async () => {
    const file = await writePackage(
      "@acme/bad-manifest",
      { modules: [{ contributes: {} }] },
      "export default { modules: {} };",
    );
    await writeConfig({ plugins: [file] });
    const result = await loadPlugins(root);
    expect(result.failed.get(file)).toMatch(/penguin\.modules\[0\]/);
  });
});
