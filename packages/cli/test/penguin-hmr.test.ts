/**
 * `penguin-hmr` acts on resolution's answer and reports it by name: a root with no record,
 * a damaged record, an unusable pointer, a missing bundle, and a loader that is present but
 * cannot load what it points at.
 *
 * The loader runs as a fixture product's own entry here — the same file layout every
 * channel ships (manifest, CLI entry, loader beside it) — because a source run has no
 * built loader to name itself with.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPushedCli } from "../src/penguin-hmr.js";

const made: string[] = [];

async function tmp(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
}

afterEach(async () => {
  while (made.length > 0) {
    const dir = made.pop();
    if (dir !== undefined) await fs.rm(dir, { recursive: true, force: true });
  }
});

/** A product whose declaration names the loader this test hands to `loadPushedCli`. */
async function makeProduct(options: { declare?: string } = {}): Promise<{ loader: string }> {
  const dir = await tmp("penguin-loader-product-");
  const dist = path.join(dir, "dist");
  await fs.mkdir(dist, { recursive: true });
  const loader = path.join(dist, "penguin-hmr.js");
  const entry = path.join(dir, "dist", "penguin.js");
  await fs.writeFile(loader, "export const nothing = 0;\n");
  await fs.writeFile(entry, "export const nothing = 0;\n");
  const manifest: Record<string, unknown> = {
    name: "fixture-cli",
    version: "0.0.0",
    penguin: { pushedCliLoader: options.declare ?? "./dist/penguin-hmr.js" },
  };
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify(manifest, null, 2));
  return { loader };
}

/** A root whose record names a CLI bundle; `bundle` decides whether the store still has it. */
async function makeRoot(
  options: {
    record?: unknown;
    raw?: string;
    bundle?: string;
  } = {},
): Promise<string> {
  const root = await tmp("penguin-loader-root-");
  if (options.record !== undefined || options.raw !== undefined) {
    await fs.mkdir(path.join(root, "hmr", "store", "cli"), { recursive: true });
    await fs.writeFile(
      path.join(root, "hmr", "harness.json"),
      options.raw ?? JSON.stringify(options.record),
    );
  }
  if (options.bundle !== undefined) {
    await fs.mkdir(path.join(root, "hmr", "store", "cli"), { recursive: true });
    await fs.writeFile(path.join(root, "hmr", "store", "cli", "abc123.mjs"), options.bundle);
  }
  return root;
}

const PUSHED = { cli: { bundle: "store/cli/abc123.mjs" } };

describe("penguin-hmr loads what resolution answers", () => {
  it("runs the pushed CLI on a root that holds one", async () => {
    const product = await makeProduct();
    const root = await makeRoot({
      record: PUSHED,
      bundle: "export const cli = async () => 7;\n",
    });
    const cli = await loadPushedCli(root, product.loader);
    await expect(cli([])).resolves.toBe(7);
  });

  it("reports `no-record` on a root nothing was ever pushed to", async () => {
    const product = await makeProduct();
    const root = await makeRoot();
    await expect(loadPushedCli(root, product.loader)).rejects.toThrow(/^no-record:/);
  });

  it("reports `no-pushed-cli` for a record holding no CLI section", async () => {
    const product = await makeProduct();
    const root = await makeRoot({ record: { platform: { bundle: "store/platform/x.mjs" } } });
    await expect(loadPushedCli(root, product.loader)).rejects.toThrow(/^no-pushed-cli:/);
  });

  it("reports `damaged-record` for a record that will not parse", async () => {
    const product = await makeProduct();
    const root = await makeRoot({ raw: "{ not json" });
    await expect(loadPushedCli(root, product.loader)).rejects.toThrow(/^damaged-record:/);
  });

  it("reports `cli-pointer-unusable` for a CLI section with no usable pointer", async () => {
    const product = await makeProduct();
    const root = await makeRoot({ record: { cli: {} } });
    await expect(loadPushedCli(root, product.loader)).rejects.toThrow(/^cli-pointer-unusable:/);
  });

  it("reports `cli-bundle-missing` when the store lost the file", async () => {
    const product = await makeProduct();
    const root = await makeRoot({ record: PUSHED });
    await expect(loadPushedCli(root, product.loader)).rejects.toThrow(/^cli-bundle-missing:/);
  });

  it("reports `loader-missing` for a declaration that names no present loader", async () => {
    const product = await makeProduct({ declare: "./dist/gone.js" });
    const root = await makeRoot({ record: PUSHED, bundle: "export const cli = async () => 0;\n" });
    await expect(loadPushedCli(root, product.loader)).rejects.toThrow(/^loader-missing:/);
  });

  it("reports `loader-unloadable` for a loader that cannot load its CLI", async () => {
    const product = await makeProduct();
    const root = await makeRoot({
      record: PUSHED,
      bundle: "export const notACli = async () => 0;\n",
    });
    await expect(loadPushedCli(root, product.loader)).rejects.toThrow(/^loader-unloadable:/);
  });
});
