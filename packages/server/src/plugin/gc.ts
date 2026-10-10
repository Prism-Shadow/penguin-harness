/**
 * The plugin sweep: the store (plugin/store.ts) and the activation directory
 * (plugin/activation.ts) do not grow without bound.
 *
 * A complete store entry is KEPT when any of these holds, and removed otherwise:
 *
 *   - a generation the sweep keeps (the current one and the one before it) links it;
 *   - a Project's table pins it — the shared table or any machine's;
 *   - it was stored less than a day ago (the mtime of its `.stored`).
 *
 * A package the build ships but no kept generation links goes like any other: the next
 * activation stores it again from the shipped prefix. An entry without `.stored` is a write
 * that did not finish, and goes once it is a day old; so does anything under `.staging/`. A
 * `<version>/`, `<name>/` or bucket directory goes with its last entry. Every other generation
 * goes. Nothing outside the store's `packages/` is an entry, so an earlier layout's directories
 * are neither kept nor removed here.
 *
 * WHEN. The loader sweeps right after an activation that flipped `current`, and once per
 * process at the first activation — always after the pointer is written, never while a
 * generation is: activation and sweep run in one boot, and boots take turns on the platform's
 * assembly queue. The store part also takes its turn on the store's own queue, behind any
 * fetch in flight (`onStoreQueue`).
 *
 * BEST EFFORT. Nothing here fails a boot: each failure is logged and the sweep goes on with
 * the rest. When a kept generation cannot be read, no store entry is removed on that sweep.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import { GENERATION, pluginsDir, readGeneration } from "./activation.js";
import {
  isStored,
  onStoreQueue,
  pluginStoreDir,
  STAGING_DIR,
  STORED_FILE,
  storeEntryDirs,
} from "./store.js";
import { entryKey } from "../../../../scripts/plugin-entry.mjs";

/** How long a stored entry is kept whatever references it, and how long unfinished work may sit. */
export const STORE_GRACE_MS = 24 * 60 * 60 * 1000;

/** One content a Project pins. */
export interface PluginPin {
  name: string;
  /** npm's integrity, `sha512-<base64>`. */
  integrity: string;
}

export interface SweepOptions {
  /** The generations to keep: the current one and the one before it. */
  keep: readonly string[];
  /** What any Project's table pins. */
  pins?: readonly PluginPin[];
  /** The clock, for tests. */
  now?: number;
  log?: (message: string) => void;
}

/** How much one sweep removed, and what it could not. */
export interface SweepReport {
  entries: number;
  generations: number;
  staging: number;
  /** Why a part was skipped or a removal failed. */
  failures: string[];
}

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** `<name>/<key>` of every content something still needs, or null when that cannot be known. */
async function keptContents(root: string, options: SweepOptions): Promise<Set<string> | null> {
  const kept = new Set<string>();
  for (const gen of options.keep) {
    const entries = await readGeneration(root, gen);
    if (entries === null) return null;
    for (const e of entries) {
      // A local link (a name linked to a directory, plugin/links.ts) pins no store content:
      // what it holds is outside the store, and never the sweep's to remove.
      if (!("integrity" in e)) continue;
      kept.add(`${e.name}/${entryKey(e.integrity)}`);
    }
  }
  for (const pin of options.pins ?? []) {
    const key = entryKey(pin.integrity);
    if (key !== null) kept.add(`${pin.name}/${key}`);
  }
  return kept;
}

/** How old a path is, by its mtime. */
async function age(p: string, now: number): Promise<number> {
  return now - (await fsp.stat(p)).mtimeMs;
}

/** The store part: every entry nothing keeps, and each directory its last entry leaves empty. */
async function sweepStore(
  root: string,
  kept: ReadonlySet<string> | null,
  now: number,
  report: SweepReport,
): Promise<void> {
  const parents = new Set<string>();
  for (const { name, key, dir } of await storeEntryDirs(root)) {
    try {
      const done = isStored(dir);
      // Nothing known to keep (`kept` null) keeps every complete entry.
      if (done && (kept === null || kept.has(`${name}/${key}`))) continue;
      if ((await age(done ? path.join(dir, STORED_FILE) : dir, now)) < STORE_GRACE_MS) continue;
      await fsp.rm(dir, { recursive: true, force: true });
      report.entries += 1;
      parents.add(path.dirname(dir));
    } catch (err) {
      report.failures.push(`${name}/${key}: ${reason(err)}`);
    }
  }
  // `<version>/`, `<name>/`, its buckets and a scope's directory, each once it is empty.
  const store = pluginStoreDir(root);
  const removed = (dir: string) =>
    fsp.rmdir(dir).then(
      () => true,
      () => false,
    );
  for (let dir of parents) {
    while (dir !== store && (await removed(dir))) dir = path.dirname(dir);
  }
}

/** Every generation but the kept ones. */
async function sweepGenerations(
  root: string,
  keep: readonly string[],
  report: SweepReport,
): Promise<void> {
  let dirs: string[];
  try {
    dirs = await fsp.readdir(pluginsDir(root));
  } catch {
    return;
  }
  for (const gen of dirs) {
    if (!GENERATION.test(gen) || keep.includes(gen)) continue;
    try {
      await fsp.rm(path.join(pluginsDir(root), gen), { recursive: true, force: true });
      report.generations += 1;
    } catch (err) {
      report.failures.push(`generation ${gen}: ${reason(err)}`);
    }
  }
}

/** Every `.staging/` directory a day old: work no write finished. */
async function sweepStaging(root: string, now: number, report: SweepReport): Promise<void> {
  const staging = path.join(pluginStoreDir(root), STAGING_DIR);
  let dirs: string[];
  try {
    dirs = await fsp.readdir(staging);
  } catch {
    return;
  }
  for (const dir of dirs) {
    try {
      if ((await age(path.join(staging, dir), now)) < STORE_GRACE_MS) continue;
      await fsp.rm(path.join(staging, dir), { recursive: true, force: true });
      report.staging += 1;
    } catch (err) {
      report.failures.push(`${STAGING_DIR}/${dir}: ${reason(err)}`);
    }
  }
}

/**
 * Sweeps the store and the activation directory of `root` (the rules are this file's header).
 * Never throws: what failed is in the report and in the log.
 */
export async function sweepPlugins(root: string, options: SweepOptions): Promise<SweepReport> {
  const log = options.log ?? ((m: string) => console.warn(m));
  const now = options.now ?? Date.now();
  const report: SweepReport = { entries: 0, generations: 0, staging: 0, failures: [] };
  try {
    await onStoreQueue(async () => {
      const kept = await keptContents(root, options);
      if (kept === null)
        report.failures.push("a kept generation cannot be read: no store entry is removed");
      await sweepGenerations(root, options.keep, report);
      await sweepStaging(root, now, report);
      await sweepStore(root, kept, now, report);
    });
  } catch (err) {
    report.failures.push(reason(err));
  }
  if (report.entries + report.generations + report.staging > 0) {
    log(
      `[plugin-store] swept ${report.entries} entries, ${report.generations} generations, ${report.staging} staging directories`,
    );
  }
  for (const failure of report.failures) log(`[plugin-store] sweep: ${failure}`);
  return report;
}
