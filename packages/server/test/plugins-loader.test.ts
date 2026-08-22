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
import { PLUGINS_FILE, loadConfiguredPlugins, readPluginList } from "../src/plugin/loader.js";

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
    expect(await loadConfiguredPlugins(root)).toEqual({ loaded: [], failed: new Map() });
  });

  it("reads the configured specifiers in order", async () => {
    await writeConfig({ plugins: ["a", "b"] });
    expect(await readPluginList(root)).toEqual(["a", "b"]);
  });

  it("a malformed config is surfaced, not silently treated as empty", async () => {
    await writeFile(path.join(root, PLUGINS_FILE), "{not json", "utf8");
    await expect(readPluginList(root)).rejects.toThrow(/not valid JSON/);
    // Through the loader it becomes a reported failure rather than a throw.
    const result = await loadConfiguredPlugins(root);
    expect(result.loaded).toEqual([]);
    expect(result.failed.get(PLUGINS_FILE)).toMatch(/not valid JSON/);
  });

  it("a config with the wrong shape names the shape it wanted", async () => {
    await writeConfig({ plugins: [1, 2] });
    await expect(readPluginList(root)).rejects.toThrow(/package specifier/);
  });
});

describe("plugin loading", () => {
  it("loads a plugin module's exported activate", async () => {
    const file = await writePluginModule("ok", "export function activate() {}");
    await writeConfig({ plugins: [file] });
    const result = await loadConfiguredPlugins(root);
    expect(result.failed.size).toBe(0);
    expect(result.loaded).toHaveLength(1);
    expect(result.loaded[0]!.specifier).toBe(file);
    expect(typeof result.loaded[0]!.plugin.activate).toBe("function");
  });

  it("an unresolvable specifier is skipped with its reason, not fatal", async () => {
    const good = await writePluginModule("good", "export function activate() {}");
    await writeConfig({ plugins: ["@nope/definitely-not-installed", good] });
    const result = await loadConfiguredPlugins(root);
    // The good one still loads: failure is per entry.
    expect(result.loaded.map((entry) => entry.specifier)).toEqual([good]);
    expect(result.failed.get("@nope/definitely-not-installed")).toBeTruthy();
  });

  it("a module without an activate export is skipped, saying what was expected", async () => {
    const file = await writePluginModule("bad", "export default { activate() {} };");
    await writeConfig({ plugins: [file] });
    const result = await loadConfiguredPlugins(root);
    // The contract is the NAMED export — an activate tucked inside a default object is
    // not it, and tolerating it would fork the ecosystem into two shapes.
    expect(result.loaded).toEqual([]);
    expect(result.failed.get(file)).toMatch(/activate\(ctx\) function/);
  });

  it("a plugin that throws while loading is skipped with its error", async () => {
    const file = await writePluginModule("throws", "throw new Error('boom at import');");
    await writeConfig({ plugins: [file] });
    const result = await loadConfiguredPlugins(root);
    expect(result.loaded).toEqual([]);
    expect(result.failed.get(file)).toMatch(/boom at import/);
  });
});
