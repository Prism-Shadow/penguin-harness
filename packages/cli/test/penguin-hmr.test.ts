/**
 * `penguin-hmr` acts on resolution's answer and reports it by name: it runs the pushed CLI
 * a root holds, and answers `own-entry`, `record-unreadable` or `cli-unloadable` with a
 * sentence of its own when it cannot.
 *
 * The loader runs as a fixture product's own entry here — the file layout every channel
 * ships (manifest, CLI entry, loader beside it) — because a source run has no built loader
 * to name itself with.
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
async function makeProduct(): Promise<{ loader: string }> {
  const dir = await tmp("penguin-loader-product-");
  const dist = path.join(dir, "dist");
  await fs.mkdir(dist, { recursive: true });
  const loader = path.join(dist, "penguin-hmr.js");
  const entry = path.join(dist, "penguin.js");
  await fs.writeFile(loader, "export const nothing = 0;\n");
  await fs.writeFile(entry, "export const nothing = 0;\n");
  const manifest = {
    name: "fixture-cli",
    version: "0.0.0",
    penguin: { cliLoader: "./dist/penguin-hmr.js" },
  };
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify(manifest, null, 2));
  return { loader };
}

/** A root whose record names a CLI bundle; `bundle` decides whether the store still has it. */
async function makeRoot(
  options: { record?: unknown; raw?: string; bundle?: string } = {},
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

  it("reports `own-entry` on a root nothing was ever pushed to", async () => {
    const product = await makeProduct();
    await expect(loadPushedCli(await makeRoot(), product.loader)).rejects.toThrow(/^own-entry:/);
  });

  it("reports `record-unreadable` for a record that will not parse", async () => {
    const product = await makeProduct();
    const root = await makeRoot({ raw: "{ not json" });
    await expect(loadPushedCli(root, product.loader)).rejects.toThrow(/^record-unreadable:/);
  });

  it("reports `cli-unloadable` for a CLI that cannot load", async () => {
    const product = await makeProduct();
    const root = await makeRoot({
      record: PUSHED,
      bundle: "export const notACli = async () => 0;\n",
    });
    await expect(loadPushedCli(root, product.loader)).rejects.toThrow(/^cli-unloadable:/);
  });
});
