/**
 * `penguin-hmr` acts on the record's answer and reports it by name: it runs the pushed CLI
 * a root holds, and answers `record-unsupported` or `cli-unloadable` with a sentence of its
 * own when it cannot.
 *
 * The loader runs as this module's own entry here; the record's entry decides what runs,
 * so the fixtures name their own entries the way a push of this version records them.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadCli } from "../src/penguin-hmr.js";

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

/** A root whose record's CLI half carries an entry; `bundle` decides whether the store has it. */
async function makeRoot(
  options: {
    record?: unknown;
    raw?: string;
    bundle?: string | false;
    entry?: string | false;
  } = {},
): Promise<string> {
  const root = await tmp("penguin-loader-root-");
  if (options.record !== undefined || options.raw !== undefined) {
    await fs.mkdir(path.join(root, "hmr"), { recursive: true });
    await fs.writeFile(
      path.join(root, "hmr", "harness.json"),
      options.raw ?? JSON.stringify(options.record),
    );
  }
  if (options.bundle !== undefined && options.bundle !== false) {
    await fs.mkdir(path.join(root, "hmr", "store", "cli"), { recursive: true });
    await fs.writeFile(path.join(root, "hmr", "store", "cli", "abc123.mjs"), options.bundle);
  }
  return root;
}

/** The record a push of this version leaves: the loader's entry beside the bundle. */
const recordWith = (entry: string) => ({
  cli: { bundle: "store/cli/abc123.mjs", entry },
});
/** A record a version before recorded entries left: a bundle only. */
const LEGACY_RECORD = { cli: { bundle: "store/cli/abc123.mjs" } };

describe("penguin-hmr loads what the record names", () => {
  it("runs the pushed CLI on a root that holds one", async () => {
    const root = await makeRoot({
      record: recordWith("/nowhere/penguin-hmr.js"),
      bundle: "export const cli = async () => 7;\n",
    });
    const cli = await loadCli(root);
    await expect(cli([])).resolves.toBe(7);
  });

  it("reports `own-entry` on a root nothing was ever pushed to", async () => {
    await expect(loadCli(await makeRoot())).rejects.toThrow(/^own-entry:/);
  });

  it("reports `record-unsupported` for a record that will not parse", async () => {
    const root = await makeRoot({ raw: "{ not json" });
    await expect(loadCli(root)).rejects.toThrow(/^record-unsupported:/);
  });

  it("reports `record-unsupported` for a pre-entry record, naming the remedy", async () => {
    const root = await makeRoot({
      record: LEGACY_RECORD,
      bundle: "export const cli = async () => 0;\n",
    });
    await expect(loadCli(root)).rejects.toThrow(/^record-unsupported:/);
  });

  it("reports `cli-unloadable` for a CLI that cannot load", async () => {
    const root = await makeRoot({
      record: recordWith("/nowhere/penguin-hmr.js"),
      bundle: "export const notACli = async () => 0;\n",
    });
    await expect(loadCli(root)).rejects.toThrow(/^cli-unloadable:/);
  });
});
