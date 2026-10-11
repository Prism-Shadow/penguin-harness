/**
 * Which CLI entry starts a server (src/server-entry.ts): the pushed one, through the
 * `penguin-hmr` loader, when the data root records a usable pushed CLI; the installed one
 * otherwise.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serverStartEntry } from "../src/server-entry.js";

let dir: string;
let root: string;
let installed: string;
let loader: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-server-entry-"));
  root = path.join(dir, "root");
  const dist = path.join(dir, "lib", "dist");
  installed = path.join(dist, "penguin.js");
  loader = path.join(dist, "penguin-hmr.js");
  await fs.mkdir(dist, { recursive: true });
  await fs.writeFile(installed, "");
  await fs.writeFile(loader, "");
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/** Records a pushed CLI at `<root>/hmr/store/cli/x.mjs`, the file itself present or not. */
async function pushCli(opts: { present: boolean }): Promise<void> {
  const hmr = path.join(root, "hmr");
  await fs.mkdir(path.join(hmr, "store", "cli"), { recursive: true });
  if (opts.present) await fs.writeFile(path.join(hmr, "store", "cli", "x.mjs"), "");
  await fs.writeFile(
    path.join(hmr, "harness.json"),
    JSON.stringify({ cli: { bundle: "store/cli/x.mjs" } }),
  );
}

describe("serverStartEntry", () => {
  it("starts through the loader when the root has a pushed CLI", async () => {
    await pushCli({ present: true });
    expect(await serverStartEntry(installed, root)).toBe(loader);
  });

  it("starts the installed CLI when nothing was pushed", async () => {
    expect(await serverStartEntry(installed, root)).toBe(installed);
  });

  it("starts the installed CLI when the record names a bundle the store no longer has", async () => {
    await pushCli({ present: false });
    expect(await serverStartEntry(installed, root)).toBe(installed);
  });

  it("starts the installed CLI when the installation has no loader beside it", async () => {
    await pushCli({ present: true });
    await fs.rm(loader);
    expect(await serverStartEntry(installed, root)).toBe(installed);
  });

  it("keeps the loader when the supervisor itself runs through it", async () => {
    expect(await serverStartEntry(loader, root)).toBe(loader);
  });
});
