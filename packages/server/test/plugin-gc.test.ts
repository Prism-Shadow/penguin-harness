/**
 * The plugin sweep (src/plugin/gc.ts): the store keeps what a generation, a kept push or a pin
 * needs and what is less than a day old; the activation directory keeps the current and the
 * previous generation; `.staging/` keeps live processes'.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stringify as stringifyToml } from "smol-toml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { activatePlugins } from "../src/plugin/activation.js";
import type { PluginAsk } from "../src/plugin/activation.js";
import { STORE_GRACE_MS, sweepPlugins } from "../src/plugin/gc.js";
import { loadPlugins } from "../src/plugin/loader.js";
import { pluginStoreDir, storePackage } from "../src/plugin/store.js";
import type { StoredEntry } from "../src/plugin/store.js";
import { writeClassPackage } from "./plugin-fixtures.js";

let dir: string;
let root: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-gc-"));
  root = path.join(dir, "root");
  await fs.mkdir(root);
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const DAY = STORE_GRACE_MS;
/** The sweep's clock: two days after everything here was written. */
const later = () => Date.now() + 2 * DAY;
const asks = (names: string[]) =>
  new Map<string, PluginAsk[]>(names.map((n) => [n, [{}]] as [string, PluginAsk[]]));

async function exists(p: string): Promise<boolean> {
  return fs.access(p).then(
    () => true,
    () => false,
  );
}

/** A package stored the way a registry fetch stores it. */
async function stored(name: string, module: string): Promise<StoredEntry> {
  const prefix = path.join(dir, "fetched", module);
  await fs.mkdir(prefix, { recursive: true });
  await fs.writeFile(path.join(prefix, "package.json"), "{}");
  const pkg = path.join(prefix, "node_modules", ...name.split("/"));
  await writeClassPackage(pkg, { name, module, version: "1.0.0" });
  return storePackage(root, pkg, prefix, "registry");
}

/** Rewrites an entry's `.stored` as if it were stored at `at`. */
async function storedAt(entry: StoredEntry, at: number): Promise<void> {
  await fs.writeFile(
    path.join(entry.dir, ".stored"),
    stringifyToml({ storedAt: new Date(at).toISOString(), source: "registry" }),
  );
}

describe("the store", () => {
  it("keeps what a generation, a kept push, a pin or the last day needs, and removes the rest", async () => {
    const inCurrent = await stored("@acme/current", "Current");
    const inPrevious = await stored("@acme/previous", "Previous");
    const pushed = await stored("@acme/pushed", "Pushed");
    const pinned = await stored("@acme/pinned", "Pinned");
    const recent = await stored("@acme/recent", "Recent");
    const stale = await stored("@acme/stale", "Stale");
    await activatePlugins(root, asks(["@acme/previous"]), null);
    await activatePlugins(root, asks(["@acme/current"]), null);
    const set = path.join(root, "hmr", "store", "assets", "0a1b", "plugins");
    await fs.mkdir(set, { recursive: true });
    const { name, version, integrity } = pushed;
    await fs.writeFile(
      path.join(set, "index.json"),
      JSON.stringify([{ name, version, integrity }]),
    );
    const now = later();
    await storedAt(recent, now - DAY + 60_000);

    await sweepPlugins(root, {
      pins: [{ name: pinned.name, integrity: pinned.integrity }],
      now,
      log: () => {},
    });
    for (const e of [inCurrent, inPrevious, pushed, pinned, recent]) {
      expect(await exists(e.dir), e.name).toBe(true);
    }
    expect(await exists(path.join(pluginStoreDir(root), "@acme", "stale"))).toBe(false);
    expect(await exists(stale.dir)).toBe(false);
  });

  it("removes no entry when what must be kept cannot be read", async () => {
    const stale = await stored("@acme/stale", "Stale");
    await activatePlugins(root, asks([]), null);
    const set = path.join(root, "hmr", "store", "assets", "bad", "plugins");
    await fs.mkdir(set, { recursive: true });
    await fs.writeFile(path.join(set, "index.json"), "{ not json");
    const report = await sweepPlugins(root, { now: later(), log: () => {} });
    expect(await exists(stale.dir)).toBe(true);
    expect(report.entries).toEqual([]);
  });
});

describe("the activation directory and .staging", () => {
  it("keep the current and the previous generation, and live processes' staging", async () => {
    await stored("@acme/a", "A");
    await stored("@acme/b", "B");
    const a = await activatePlugins(root, asks(["@acme/a"]), null);
    await activatePlugins(root, asks(["@acme/b"]), null);
    await activatePlugins(root, asks(["@acme/a", "@acme/b"]), null);
    const staging = path.join(pluginStoreDir(root), ".staging");
    const gone = spawnSync(process.execPath, ["-e", ""]).pid;
    for (const d of [String(process.pid), String(gone)]) {
      await fs.mkdir(path.join(staging, d), { recursive: true });
    }
    const report = await sweepPlugins(root, { log: () => {} });
    expect(report.generations).toEqual([a.current]);
    expect(await fs.readdir(staging)).toEqual([String(process.pid)]);
  });
});

describe("the loader", () => {
  it("sweeps at the first activation of the process, a machine table's pin included", async () => {
    const pinned = await stored("@acme/pinned", "Pinned");
    const stale = await stored("@acme/stale", "Stale");
    await fs.mkdir(path.join(root, "p1"), { recursive: true });
    await fs.writeFile(
      path.join(root, "p1", ".project_config.toml"),
      `models = []\n[plugins.Xk3v9Qa_bT2mLp0z]\n"@acme/pinned" = { integrity = "${pinned.integrity}" }\n`,
    );
    await storedAt(pinned, Date.now() - 2 * DAY);
    await storedAt(stale, Date.now() - 2 * DAY);
    await loadPlugins(root, null);
    expect(await exists(pinned.dir)).toBe(true);
    expect(await exists(stale.dir)).toBe(false);
  });
});
