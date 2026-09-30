/**
 * The plugin sweep (src/plugin/gc.ts): after a flip and at startup, the store keeps what a
 * generation, a kept push or a pin needs and what is less than a day old; the activation
 * directory keeps the current and the previous generation; `.staging/` keeps live processes'.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stringify as stringifyToml } from "smol-toml";
import * as tar from "tar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  activatePlugins,
  currentGeneration,
  pointCurrent,
  previousGeneration,
} from "../src/plugin/activation.js";
import type { PluginAsk } from "../src/plugin/activation.js";
import { STORE_GRACE_MS, sweepPlugins } from "../src/plugin/gc.js";
import { loadPlugins, readPluginPins } from "../src/plugin/loader.js";
import { pluginStoreDir, readStore, storePackage } from "../src/plugin/store.js";
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
async function stored(name: string, module: string, version = "1.0.0"): Promise<StoredEntry> {
  const prefix = path.join(dir, "fetched", `${module}-${version}`);
  await fs.mkdir(prefix, { recursive: true });
  await fs.writeFile(path.join(prefix, "package.json"), "{}");
  const pkg = path.join(prefix, "node_modules", ...name.split("/"));
  await writeClassPackage(pkg, { name, module, version });
  return storePackage(root, pkg, prefix, "registry");
}

/** Rewrites an entry's `.stored` as if it were stored at `at`. */
async function storedAt(entry: StoredEntry, at: number): Promise<void> {
  await fs.writeFile(
    path.join(entry.dir, ".stored"),
    stringifyToml({ storedAt: new Date(at).toISOString(), source: "registry" }),
  );
}

/** A kept assets set whose plugin prefix lists `entries` in its index.json. */
async function pushedSet(sha: string, entries: StoredEntry[]): Promise<string> {
  const set = path.join(root, "hmr", "store", "assets", sha);
  await fs.mkdir(path.join(set, "plugins"), { recursive: true });
  await fs.writeFile(
    path.join(set, "plugins", "index.json"),
    JSON.stringify(entries.map(({ name, version, integrity }) => ({ name, version, integrity }))),
  );
  return set;
}

describe("the store", () => {
  it("keeps what a generation, a kept push, a pin or the last day needs, and removes the rest", async () => {
    const inCurrent = await stored("@acme/current", "Current");
    const inPrevious = await stored("@acme/previous", "Previous");
    const pushed = await stored("@acme/pushed", "Pushed");
    const pinned = await stored("@acme/pinned", "Pinned");
    const recent = await stored("@acme/recent", "Recent");
    const stale = await stored("@acme/stale", "Stale");
    const staleSibling = await stored("@acme/current", "CurrentOld", "0.9.0");
    await activatePlugins(root, asks(["@acme/previous"]), null);
    await activatePlugins(root, asks(["@acme/current"]), null);
    await pushedSet("0a1b", [pushed]);
    const now = later();
    await storedAt(recent, now - DAY + 60_000);

    const logged: string[] = [];
    const report = await sweepPlugins(root, {
      pins: [{ name: pinned.name, integrity: pinned.integrity }],
      now,
      log: (m) => logged.push(m),
    });

    const id = (e: StoredEntry) => `${e.name}/${e.version}/${path.basename(e.dir)}`;
    expect(report.entries.sort()).toEqual([id(stale), id(staleSibling)].sort());
    expect(report.failures).toEqual([]);
    for (const e of [inCurrent, inPrevious, pushed, pinned, recent]) {
      expect(await exists(e.dir)).toBe(true);
    }
    // The last entry of a version takes its directory with it, and of a name, the name's.
    expect(await exists(path.dirname(staleSibling.dir))).toBe(false);
    expect(await exists(path.join(pluginStoreDir(root), "@acme", "stale"))).toBe(false);
    expect(await exists(path.join(pluginStoreDir(root), "@acme", "current", "1.0.0"))).toBe(true);
    // The store's index follows.
    const index = JSON.parse(
      await fs.readFile(path.join(pluginStoreDir(root), "index.json"), "utf8"),
    ) as Array<{ name: string }>;
    expect(index.map((e) => e.name).sort()).toEqual(
      ["@acme/current", "@acme/pinned", "@acme/previous", "@acme/pushed", "@acme/recent"].sort(),
    );
    expect(logged).toEqual([expect.stringContaining("swept 2 entries")]);
  });

  it("keeps nothing extra on the day an entry was stored", async () => {
    const fresh = await stored("@acme/fresh", "Fresh");
    await activatePlugins(root, asks([]), null);
    const report = await sweepPlugins(root, { log: () => {} });
    expect(report.entries).toEqual([]);
    expect(await exists(fresh.dir)).toBe(true);
  });

  it("removes an entry without its completion marker once it is a day old", async () => {
    await activatePlugins(root, asks([]), null);
    const old = path.join(pluginStoreDir(root), "@acme", "half", "1.0.0", "0123456789abcdef");
    const young = path.join(pluginStoreDir(root), "@acme", "half", "1.0.1", "fedcba9876543210");
    for (const d of [old, young]) {
      await fs.mkdir(path.join(d, "package"), { recursive: true });
    }
    const aged = new Date(Date.now() - DAY - 60_000);
    await fs.utimes(old, aged, aged);
    const report = await sweepPlugins(root, { log: () => {} });
    expect(report.unfinished).toEqual(["@acme/half/1.0.0/0123456789abcdef"]);
    expect(await exists(path.dirname(old))).toBe(false);
    expect(await exists(young)).toBe(true);
  });

  it("reads the list of a kept push it never unpacked out of the push's own archive", async () => {
    const pushed = await stored("@acme/pushed", "Pushed");
    const other = await stored("@acme/other", "Other");
    await activatePlugins(root, asks([]), null);
    const set = path.join(root, "hmr", "store", "assets", "beef");
    const files = path.join(dir, "loose");
    await fs.mkdir(path.join(files, "plugins"), { recursive: true });
    const { name, version, integrity } = pushed;
    await fs.writeFile(
      path.join(files, "plugins", "index.json"),
      JSON.stringify([{ name, version, integrity }]),
    );
    await fs.writeFile(path.join(files, "plugins", "package.json"), "{}");
    await fs.mkdir(path.join(set, "archives"), { recursive: true });
    await tar.c({ gzip: true, file: path.join(set, "archives", "plugins.tgz"), cwd: files }, [
      "plugins/index.json",
      "plugins/package.json",
    ]);
    const report = await sweepPlugins(root, { now: later(), log: () => {} });
    expect(await exists(pushed.dir)).toBe(true);
    expect(await exists(other.dir)).toBe(false);
    expect(report.failures).toEqual([]);
    // Nothing of the reading is left behind.
    expect(await fs.readdir(path.join(pluginStoreDir(root), ".staging"))).toEqual([]);
    expect(await exists(path.join(set, ".unpacked"))).toBe(false);
  });

  it("keeps every content of a version a push from before index.json lists", async () => {
    const a = await stored("@acme/listed", "A");
    const b = await stored("@acme/listed", "B");
    await activatePlugins(root, asks([]), null);
    const set = path.join(root, "hmr", "store", "assets", "cafe", "plugins");
    await fs.mkdir(set, { recursive: true });
    await fs.writeFile(
      path.join(set, "package.json"),
      JSON.stringify({ dependencies: { "@acme/listed": "1.0.0" } }),
    );
    await sweepPlugins(root, { now: later(), log: () => {} });
    expect(await exists(a.dir)).toBe(true);
    expect(await exists(b.dir)).toBe(true);
  });

  it("removes no entry when what must be kept cannot be read, and says so", async () => {
    const stale = await stored("@acme/stale", "Stale");
    await activatePlugins(root, asks([]), null);
    const set = path.join(root, "hmr", "store", "assets", "bad", "plugins");
    await fs.mkdir(set, { recursive: true });
    await fs.writeFile(path.join(set, "index.json"), "{ not json");
    const logged: string[] = [];
    const report = await sweepPlugins(root, { now: later(), log: (m) => logged.push(m) });
    expect(await exists(stale.dir)).toBe(true);
    expect(report.entries).toEqual([]);
    expect(logged).toEqual([expect.stringMatching(/cannot be read.*no store entry is removed/)]);
  });
});

describe("the activation directory", () => {
  it("keeps the current and the previous generation, whichever order the flips came in", async () => {
    await stored("@acme/a", "A");
    await stored("@acme/b", "B");
    const a = await activatePlugins(root, asks(["@acme/a"]), null);
    const b = await activatePlugins(root, asks(["@acme/b"]), null);
    const both = await activatePlugins(root, asks(["@acme/a", "@acme/b"]), null);
    expect(previousGeneration(root)).toBe(b.current);
    // Back to a generation still on disk, then on to a new one: `previous` is the one flipped
    // away from, not the one written last.
    const first = await sweepPlugins(root, { log: () => {} });
    expect(first.generations).toEqual([a.current]);
    await pointCurrent(root, b.current);
    expect(previousGeneration(root)).toBe(both.current);
    const none = await activatePlugins(root, asks([]), null);
    const report = await sweepPlugins(root, { log: () => {} });
    expect(report.generations).toEqual([both.current]);
    const left = (await fs.readdir(path.join(root, "plugins"))).sort();
    expect(left).toEqual([b.current, none.current, "current", "previous"].sort());
    expect(currentGeneration(root)).toBe(none.current);
  });

  it("keeps only the current generation for a root whose pointer has no previous beside it", async () => {
    await stored("@acme/a", "A");
    const a = await activatePlugins(root, asks(["@acme/a"]), null);
    const c = await activatePlugins(root, asks([]), null);
    await fs.rm(path.join(root, "plugins", "previous"));
    const report = await sweepPlugins(root, { log: () => {} });
    expect(report.generations).toEqual([a.current]);
    expect(await exists(path.join(root, "plugins", c.current))).toBe(true);
  });
});

describe(".staging", () => {
  it("keeps a live process's directory and removes every other", async () => {
    await activatePlugins(root, asks([]), null);
    const staging = path.join(pluginStoreDir(root), ".staging");
    const gone = spawnSync(process.execPath, ["-e", ""]).pid;
    for (const d of [String(process.pid), String(gone), "not-a-pid"]) {
      await fs.mkdir(path.join(staging, d, "entry-1"), { recursive: true });
    }
    const report = await sweepPlugins(root, { log: () => {} });
    expect(report.staging.sort()).toEqual([String(gone), "not-a-pid"].sort());
    expect(await fs.readdir(staging)).toEqual([String(process.pid)]);
  });
});

describe("the loader", () => {
  async function writeProject(projectId: string, text: string): Promise<void> {
    await fs.mkdir(path.join(root, projectId), { recursive: true });
    await fs.writeFile(path.join(root, projectId, ".project_config.toml"), text);
  }

  it("reads a pin from the shared table and from any machine's", async () => {
    const hex = (c: string) => `sha256-${c.repeat(64)}`;
    await writeProject(
      "p1",
      `models = []\n[plugins]\n"@acme/one" = { version = "1.0.0", integrity = "${hex("a")}" }\n"@acme/free" = "*"\n\n[plugins.Xk3v9Qa_bT2mLp0z]\n"@acme/two" = { integrity = "${hex("b")}" }\n`,
    );
    await writeProject("p2", "models = []\n");
    expect(await readPluginPins(root)).toEqual([
      { name: "@acme/one", integrity: hex("a") },
      { name: "@acme/two", integrity: hex("b") },
    ]);
  });

  it("sweeps at the first activation of the process, pins included", async () => {
    const pinned = await stored("@acme/pinned", "Pinned");
    const stale = await stored("@acme/stale", "Stale");
    await writeProject(
      "p1",
      `models = []\n[plugins.Xk3v9Qa_bT2mLp0z]\n"@acme/pinned" = { integrity = "${pinned.integrity}" }\n`,
    );
    const aged = Date.now() - 2 * DAY;
    await storedAt(pinned, aged);
    await storedAt(stale, aged);
    const result = await loadPlugins(root, null);
    expect(result.activation).not.toBeNull();
    expect(await exists(pinned.dir)).toBe(true);
    expect(await exists(stale.dir)).toBe(false);
    expect((await readStore(root)).map((e) => e.name)).toEqual(["@acme/pinned"]);
  });
});
