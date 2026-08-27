/**
 * Behavior tests for extension loading: extensions are CONFIGURATION read from the data
 * root, resolved against the installation, and every failure is per-entry and
 * non-fatal — the capability an extension would have provided stays unavailable rather
 * than the boot failing.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { EXTENSIONS_FILE, loadExtensions, readExtensionList } from "../src/extension/loader.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "penguin-extensions-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeConfig(value: unknown): Promise<void> {
  await writeFile(path.join(root, EXTENSIONS_FILE), JSON.stringify(value), "utf8");
}

/** An extension module on disk, imported by absolute specifier (the dev-checkout path). */
async function writeExtensionModule(name: string, body: string): Promise<string> {
  const dir = path.join(root, "mods");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${name}.mjs`);
  await writeFile(file, body, "utf8");
  return file;
}

describe("extension list", () => {
  it("no config file means no extensions — the default deployment shape, not an error", async () => {
    expect(await readExtensionList(root)).toEqual([]);
    expect(await loadExtensions(root)).toEqual({ loaded: [], failed: new Map() });
  });

  it("reads the configured specifiers in order", async () => {
    await writeConfig({ extensions: ["a", "b"] });
    expect(await readExtensionList(root)).toEqual(["a", "b"]);
  });

  it("a malformed config fails the load rather than presenting as empty", async () => {
    await writeFile(path.join(root, EXTENSIONS_FILE), "{not json", "utf8");
    await expect(readExtensionList(root)).rejects.toThrow(/not valid JSON/);
    // A CONFIG-level failure propagates: booting with an empty extension set would present
    // as healthy while silently dropping every capability the config asked for.
    await expect(loadExtensions(root)).rejects.toThrow(/not valid JSON/);
  });

  it("a config that exists but cannot be read is an error, not 'no extensions'", async () => {
    // A directory in its place stands in for every non-ENOENT read failure (EACCES,
    // EPERM, EISDIR, an I/O fault): something was configured and cannot be honored.
    await mkdir(path.join(root, EXTENSIONS_FILE));
    await expect(readExtensionList(root)).rejects.toThrow(/exists but could not be read/);
    await expect(loadExtensions(root)).rejects.toThrow(/exists but could not be read/);
  });

  it("a config with the wrong shape names the shape it wanted", async () => {
    await writeConfig({ extensions: [1, 2] });
    await expect(readExtensionList(root)).rejects.toThrow(/package specifier/);
  });
});

describe("extension loading", () => {
  it("loads an extension module's exported activate", async () => {
    const file = await writeExtensionModule("ok", "export function activate() {}");
    await writeConfig({ extensions: [file] });
    const result = await loadExtensions(root);
    expect(result.failed.size).toBe(0);
    expect(result.loaded).toHaveLength(1);
    expect(result.loaded[0]!.specifier).toBe(file);
    expect(typeof result.loaded[0]!.extension.activate).toBe("function");
  });

  it("an unresolvable specifier is skipped with its reason, not fatal", async () => {
    const good = await writeExtensionModule("good", "export function activate() {}");
    await writeConfig({ extensions: ["@nope/definitely-not-installed", good] });
    const result = await loadExtensions(root);
    // The good one still loads: failure is per entry.
    expect(result.loaded.map((entry) => entry.specifier)).toEqual([good]);
    expect(result.failed.get("@nope/definitely-not-installed")).toBeTruthy();
  });

  it("a module without an activate export is skipped, saying what was expected", async () => {
    const file = await writeExtensionModule("bad", "export default { activate() {} };");
    await writeConfig({ extensions: [file] });
    const result = await loadExtensions(root);
    // The contract is the NAMED export — an activate tucked inside a default object is
    // not it, and tolerating it would fork the ecosystem into two shapes.
    expect(result.loaded).toEqual([]);
    expect(result.failed.get(file)).toMatch(/activate\(ctx\) function/);
  });

  it("an extension that throws while loading is skipped with its error", async () => {
    const file = await writeExtensionModule("throws", "throw new Error('boom at import');");
    await writeConfig({ extensions: [file] });
    const result = await loadExtensions(root);
    expect(result.loaded).toEqual([]);
    expect(result.failed.get(file)).toMatch(/boom at import/);
  });
});
