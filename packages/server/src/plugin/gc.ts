/**
 * The plugin sweep: the store (plugin/store.ts) and the activation directory
 * (plugin/activation.ts) do not grow without bound.
 *
 * A complete store entry is KEPT when any of these holds, and removed otherwise:
 *
 *   - the current or the previous generation links it;
 *   - the activation list of an assets set the hot-push store still keeps (the current one
 *     and its rollback, `<root>/hmr/store/assets/<sha>/`) names it — the `index.json` the
 *     build writes into the plugin prefix it ships, or, for a push from before that file, the
 *     prefix's package.json, which keeps every content of each name and version it lists;
 *   - a Project's table pins it — the shared table or any machine's;
 *   - it was stored less than a day ago (`storedAt` in its `.stored`).
 *
 * An entry without `.stored` is a write that did not finish: it goes once it is a day old.
 * A `<version>/` or `<name>/` directory goes with its last entry. Generations other than the
 * current and the previous one go. So does every directory under `.staging/` that belongs to
 * no live process.
 *
 * WHEN. The loader sweeps right after an activation that flipped `current`, and once per
 * process at the first activation — always after the pointer is written, never while a
 * generation is: activation and sweep run in one boot, and boots take turns on the platform's
 * assembly queue. The store part also takes its turn on the store's own queue, behind any
 * fetch in flight (`onStoreQueue`).
 *
 * BEST EFFORT. Nothing here fails a boot: each failure is logged and the sweep goes on with
 * the rest. When what must be kept cannot be read (a generation, an assets set's list), no
 * store entry is removed on that sweep — the generations and the staging area still are.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import * as tar from "tar";
import { ARCHIVES_DIR, UNPACKED_DIR } from "../hmr/asset-archives.js";
import {
  currentGeneration,
  GENERATION,
  pluginsDir,
  previousGeneration,
  readGeneration,
} from "./activation.js";
import {
  INDEX_FILE,
  onStoreQueue,
  pluginStoreDir,
  rebuildStoreIndex,
  STAGING_DIR,
  stagingDir,
  STORED_FILE,
  tidyStaging,
} from "./store.js";
import { entryKey } from "../../../../scripts/plugin-entry.mjs";

/** How long a stored entry is kept whatever references it, and how long an unfinished one may sit. */
export const STORE_GRACE_MS = 24 * 60 * 60 * 1000;

/** Where the hot-push store keeps its assets sets, relative to the data root. */
const PUSHED_ASSETS = ["hmr", "store", "assets"] as const;

/** One content a Project pins. */
export interface PluginPin {
  name: string;
  /** `sha256-<hex>`. */
  integrity: string;
}

export interface SweepOptions {
  /** What any Project's table pins. */
  pins?: readonly PluginPin[];
  /** An assets set to read besides those the hot-push store keeps: the one being booted. */
  assetsDir?: string | null;
  /** The clock, for tests. */
  now?: number;
  log?: (message: string) => void;
}

/** What one sweep removed, and what it could not. */
export interface SweepReport {
  /** `<name>/<version>/<key>` of each complete entry removed. */
  entries: string[];
  /** The same, for entries without `.stored`. */
  unfinished: string[];
  generations: string[];
  staging: string[];
  /** Why a part was skipped or a removal failed. */
  failures: string[];
}

/** An entry to keep: a name, a version and a key — a null version for any, a null key for every content. */
interface Ref {
  name: string;
  version: string | null;
  key: string | null;
}

const refId = (name: string, version: string, key: string) => `${name}/${version}/${key}`;
const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The directories of `dir` whose names do not start with a dot; empty when it cannot be read. */
async function subdirs(dir: string): Promise<string[]> {
  try {
    return (await fsp.readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** Whether a process with this id is running (one we may not signal is running too). */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The entries a plugin prefix's activation list names: its `index.json`, else its package.json. */
async function prefixRefs(prefix: string): Promise<Ref[]> {
  let index: string | null = null;
  try {
    index = await fsp.readFile(path.join(prefix, INDEX_FILE), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  if (index !== null) {
    const rows = JSON.parse(index) as unknown;
    if (!Array.isArray(rows)) throw new Error(`${prefix}/${INDEX_FILE}: not an array`);
    return rows.map((row: { name?: unknown; version?: unknown; integrity?: unknown }) => {
      const key = typeof row.integrity === "string" ? entryKey(row.integrity) : null;
      if (typeof row.name !== "string" || typeof row.version !== "string" || key === null) {
        throw new Error(`${prefix}/${INDEX_FILE}: an entry without a name, version and integrity`);
      }
      return { name: row.name, version: row.version, key };
    });
  }
  let manifest: string;
  try {
    manifest = await fsp.readFile(path.join(prefix, "package.json"), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const deps = (JSON.parse(manifest) as { dependencies?: unknown }).dependencies;
  if (deps === null || typeof deps !== "object") return [];
  return Object.entries(deps as Record<string, unknown>)
    .filter((pair): pair is [string, string] => typeof pair[1] === "string")
    .map(([name, version]) => ({ name, version, key: null }));
}

/**
 * The activation list of one assets set. Read where the platform unpacked it; for a set it
 * never unpacked (a rollback copy this process did not boot), out of the archive the deploy
 * packs the prefix's own files into — without unpacking the packages.
 */
async function assetsRefs(root: string, set: string): Promise<Ref[]> {
  const unpacked = path.join(set, UNPACKED_DIR);
  if (fs.existsSync(path.join(unpacked, ".complete"))) {
    return prefixRefs(path.join(unpacked, "plugins"));
  }
  if (!fs.existsSync(path.join(set, ARCHIVES_DIR))) return prefixRefs(path.join(set, "plugins"));
  const archive = path.join(set, ARCHIVES_DIR, "plugins.tgz");
  if (!fs.existsSync(archive)) return [];
  const stage = await stagingDir(root, "gc");
  try {
    const wanted = new Set([`plugins/${INDEX_FILE}`, "plugins/package.json"]);
    await tar.x({ file: archive, cwd: stage, filter: (p) => wanted.has(p.replace(/^\.\//, "")) });
    return await prefixRefs(path.join(stage, "plugins"));
  } finally {
    await fsp.rm(stage, { recursive: true, force: true });
    await tidyStaging(root);
  }
}

/** Every entry something still needs, or the reason that cannot be known. */
async function keptRefs(
  root: string,
  current: string,
  previous: string | null,
  { pins = [], assetsDir = null }: SweepOptions,
): Promise<Ref[] | { failure: string }> {
  const refs: Ref[] = [];
  for (const gen of previous === null || previous === current ? [current] : [current, previous]) {
    const entries = await readGeneration(root, gen);
    if (entries === null) return { failure: `generation ${gen} cannot be read` };
    for (const e of entries) {
      refs.push({ name: e.name, version: e.version, key: entryKey(e.integrity) });
    }
  }
  const sets = new Set<string>();
  const kept = path.join(root, ...PUSHED_ASSETS);
  for (const sha of await subdirs(kept)) sets.add(path.resolve(kept, sha));
  if (assetsDir !== null) sets.add(path.resolve(assetsDir));
  for (const set of sets) {
    try {
      refs.push(...(await assetsRefs(root, set)));
    } catch (err) {
      return { failure: `the activation list of ${set} cannot be read: ${reason(err)}` };
    }
  }
  for (const pin of pins) {
    const key = entryKey(pin.integrity);
    // A pin names a content, not a version: whichever version directory holds that key.
    if (key !== null) refs.push({ name: pin.name, version: null, key });
  }
  return refs;
}

/** When a complete entry was stored: its `.stored` says, else the marker's own time. */
async function storedAt(dir: string): Promise<number> {
  const marker = path.join(dir, STORED_FILE);
  try {
    const at = Date.parse(String(parseToml(await fsp.readFile(marker, "utf8")).storedAt));
    if (!Number.isNaN(at)) return at;
  } catch {
    // An unreadable marker: its file's time stands in.
  }
  return (await fsp.stat(marker)).mtimeMs;
}

/** Removes a directory if it is empty; anything else (not empty, gone) leaves it. */
async function removeIfEmpty(dir: string): Promise<void> {
  await fsp.rmdir(dir).catch(() => undefined);
}

/** The store part: every entry nothing keeps, and each directory its last entry leaves empty. */
async function sweepStore(
  root: string,
  refs: readonly Ref[] | null,
  now: number,
  report: SweepReport,
): Promise<void> {
  const exact = new Set<string>();
  const anyContent = new Set<string>();
  const pinned = new Set<string>();
  for (const r of refs ?? []) {
    if (r.version === null) {
      if (r.key !== null) pinned.add(`${r.name}/${r.key}`);
    } else if (r.key === null) anyContent.add(`${r.name}/${r.version}`);
    else exact.add(refId(r.name, r.version, r.key));
  }
  const store = pluginStoreDir(root);
  const names: string[] = [];
  for (const top of await subdirs(store)) {
    if (top.startsWith("@")) {
      for (const sub of await subdirs(path.join(store, top))) names.push(`${top}/${sub}`);
    } else names.push(top);
  }
  for (const name of names) {
    const nameDir = path.join(store, ...name.split("/"));
    for (const version of await subdirs(nameDir)) {
      const versionDir = path.join(nameDir, version);
      for (const key of await subdirs(versionDir)) {
        const dir = path.join(versionDir, key);
        const id = refId(name, version, key);
        try {
          if (fs.existsSync(path.join(dir, STORED_FILE))) {
            // Nothing known to keep (`refs` null) keeps every complete entry.
            if (
              refs === null ||
              exact.has(id) ||
              anyContent.has(`${name}/${version}`) ||
              pinned.has(`${name}/${key}`) ||
              now - (await storedAt(dir)) < STORE_GRACE_MS
            ) {
              continue;
            }
            await fsp.rm(dir, { recursive: true, force: true });
            report.entries.push(id);
          } else if (now - (await fsp.stat(dir)).mtimeMs >= STORE_GRACE_MS) {
            await fsp.rm(dir, { recursive: true, force: true });
            report.unfinished.push(id);
          }
        } catch (err) {
          report.failures.push(`${id}: ${reason(err)}`);
        }
      }
      await removeIfEmpty(versionDir);
    }
    await removeIfEmpty(nameDir);
    if (name.startsWith("@")) await removeIfEmpty(path.dirname(nameDir));
  }
}

/** Every generation but the current and the previous one. */
async function sweepGenerations(
  root: string,
  keep: ReadonlySet<string>,
  report: SweepReport,
): Promise<void> {
  for (const gen of await subdirs(pluginsDir(root))) {
    if (!GENERATION.test(gen) || keep.has(gen)) continue;
    try {
      await fsp.rm(path.join(pluginsDir(root), gen), { recursive: true, force: true });
      report.generations.push(gen);
    } catch (err) {
      report.failures.push(`generation ${gen}: ${reason(err)}`);
    }
  }
}

/** Every `.staging/<dir>` that is not a live process's own. */
async function sweepStaging(root: string, report: SweepReport): Promise<void> {
  const staging = path.join(pluginStoreDir(root), STAGING_DIR);
  let dirs: string[];
  try {
    dirs = await fsp.readdir(staging);
  } catch {
    return;
  }
  for (const dir of dirs) {
    if (/^\d+$/.test(dir) && alive(Number(dir))) continue;
    try {
      await fsp.rm(path.join(staging, dir), { recursive: true, force: true });
      report.staging.push(dir);
    } catch (err) {
      report.failures.push(`${STAGING_DIR}/${dir}: ${reason(err)}`);
    }
  }
}

/**
 * Sweeps the store and the activation directory of `root` (the rules are this file's header).
 * Never throws: what failed is in the report and in the log.
 */
export async function sweepPlugins(root: string, options: SweepOptions = {}): Promise<SweepReport> {
  const log = options.log ?? ((m: string) => console.warn(m));
  const now = options.now ?? Date.now();
  const report: SweepReport = {
    entries: [],
    unfinished: [],
    generations: [],
    staging: [],
    failures: [],
  };
  try {
    await onStoreQueue(async () => {
      const current = currentGeneration(root);
      if (current === null) {
        // Nothing is known to be in use: only what belongs to no one is touched.
        report.failures.push("no current generation: the store and the generations are left");
        await sweepStaging(root, report);
        return;
      }
      // A root whose last flip predates the pointer has none: every flip writes it, and a
      // boot that fails before its first flip has nothing but `current` to point back at.
      const previous = previousGeneration(root);
      const refs = await keptRefs(root, current, previous, options);
      if ("failure" in refs) {
        report.failures.push(`${refs.failure}: no store entry is removed`);
      }
      await sweepGenerations(root, new Set([current, previous ?? current]), report);
      await sweepStaging(root, report);
      await sweepStore(root, "failure" in refs ? null : refs, now, report);
      if (report.entries.length > 0 || report.unfinished.length > 0) {
        await rebuildStoreIndex(root);
      }
    });
  } catch (err) {
    report.failures.push(reason(err));
  }
  const removed =
    report.entries.length +
    report.unfinished.length +
    report.generations.length +
    report.staging.length;
  if (removed > 0) {
    log(
      `[plugin-store] swept ${report.entries.length} entries, ${report.unfinished.length} unfinished, ${report.generations.length} generations, ${report.staging.length} staging directories`,
    );
  }
  for (const failure of report.failures) log(`[plugin-store] sweep: ${failure}`);
  return report;
}
