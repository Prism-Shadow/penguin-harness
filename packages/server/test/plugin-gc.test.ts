/**
 * The plugin sweep (src/plugin/gc.ts): the store keeps what a kept generation or a pin needs and
 * what is less than a day old; the activation directory keeps the generations it is told to;
 * `.staging/` keeps what is less than a day old.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
  return storePackage(root, pkg, prefix);
}

/** Dates an entry's `.stored`, and so the entry, at `at`. */
async function storedAt(entry: StoredEntry, at: number): Promise<void> {
  const when = new Date(at);
  await fs.utimes(path.join(entry.dir, ".stored"), when, when);
}

describe("the store", () => {
  it("keeps what a kept generation, a pin or the last day needs, and removes the rest", async () => {
    const inCurrent = await stored("@acme/current", "Current");
    const inPrevious = await stored("@acme/previous", "Previous");
    const pinned = await stored("@acme/pinned", "Pinned");
    const recent = await stored("@acme/recent", "Recent");
    const stale = await stored("@acme/stale", "Stale");
    const previous = await activatePlugins(root, asks(["@acme/previous"]), null);
    const current = await activatePlugins(root, asks(["@acme/current"]), null);
    const now = later();
    await storedAt(recent, now - DAY + 60_000);

    const report = await sweepPlugins(root, {
      keep: [current.current, previous.current],
      pins: [{ name: pinned.name, integrity: pinned.integrity }],
      now,
      log: () => {},
    });
    for (const e of [inCurrent, inPrevious, pinned, recent]) {
      expect(await exists(e.dir), e.name).toBe(true);
    }
    expect(report.entries).toBe(1);
    // The name's directory goes with its last entry.
    expect(await exists(path.join(pluginStoreDir(root), "@acme", "stale"))).toBe(false);
    expect(await exists(stale.dir)).toBe(false);
  });

  it("removes no entry when a kept generation cannot be read", async () => {
    const stale = await stored("@acme/stale", "Stale");
    const report = await sweepPlugins(root, {
      keep: ["0123456789abcdef"],
      now: later(),
      log: () => {},
    });
    expect(await exists(stale.dir)).toBe(true);
    expect(report.entries).toBe(0);
  });
});

describe("the activation directory and .staging", () => {
  it("keep the generations they are told to, and staging less than a day old", async () => {
    await stored("@acme/a", "A");
    await stored("@acme/b", "B");
    const a = await activatePlugins(root, asks(["@acme/a"]), null);
    await activatePlugins(root, asks(["@acme/b"]), null);
    const both = await activatePlugins(root, asks(["@acme/a", "@acme/b"]), null);
    const staging = path.join(pluginStoreDir(root), ".staging");
    await fs.mkdir(path.join(staging, "w-new"), { recursive: true });
    const old = new Date(Date.now() - 2 * DAY);
    await fs.mkdir(path.join(staging, "w-old"));
    await fs.utimes(path.join(staging, "w-old"), old, old);
    const report = await sweepPlugins(root, { keep: [both.current, a.current], log: () => {} });
    expect(report.generations).toBe(1);
    expect((await fs.readdir(path.join(root, "plugins"))).sort()).toEqual(
      ["current", a.current, both.current].sort(),
    );
    expect(await fs.readdir(staging)).toEqual(["w-new"]);
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
