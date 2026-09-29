/**
 * Plugin activation: the one directory a process loads plugins from.
 *
 * `<root>/plugins/` holds GENERATIONS. `plugins/current` is a pointer file naming one of them,
 * `plugins/<gen>/`, an npm prefix:
 *
 *   package.json              `dependencies` name → version (the prefix npm would write), and
 *                             `plugins` name → { version, sha256 }, what the generation is
 *   node_modules/<name>       a link to the plugin store entry's `package/` (a symlink on
 *                             POSIX, a junction on Windows; a copy where neither can be made)
 *   .complete                 written last, before the directory is renamed into place
 *
 * A generation's key is the hash of the (name, sha256) list it holds, so the same selection is
 * the same directory. Writing one is atomic for a reader: it is built in `plugins/.tmp-<pid>/`,
 * marked complete, renamed to `plugins/<gen>/`, and only then is `current` flipped — by writing a
 * temporary file and renaming it over the pointer. A reader sees the whole old generation or the
 * whole new one, never a half.
 *
 * A generation is RESOLVED from the closure (every Project's table for this machine): for each
 * name, the store entries whose version satisfies what every Project asks; among those, the one
 * the running build carries (its hot push set, or the prefix the installation ships) before
 * one fetched from the registry, then the highest version. A push that brings new content under
 * an unchanged name and version therefore wins at the next activation, with nothing else to do.
 *
 * Activation runs at every App boot — the first, a hot push's, and every re-assembly, which
 * the platform serializes on its one queue (hmr/platform.ts), so two admins' edits never
 * interleave. A boot that fails after activating flips the pointer back to the generation
 * before it. What is in `<root>/plugins/` besides generations (the npm prefix older builds
 * installed into) is neither read nor removed.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import {
  PACKAGE_DIR,
  readStore,
  shippedEntries,
  STORED_FILE,
  storeEntryDir,
  storeSources,
} from "./store.js";
import type { StoreIndexEntry, StoreSource } from "./store.js";

/** `<root>/plugins`: the activation directory. */
export const PLUGINS_DIR = "plugins";
/** The pointer file naming the current generation. */
export const CURRENT_FILE = "current";
/** A generation's completion marker, written before it is renamed into place. */
export const COMPLETE_FILE = ".complete";

const GENERATION = /^[0-9a-f]{16}$/;

export function pluginsDir(root: string): string {
  return path.join(root, PLUGINS_DIR);
}

/** What a Project asks of one name: a version range, and optionally the exact content. */
export interface PluginAsk {
  version?: string;
  /** `sha256-<hex>`: this content and no other. */
  integrity?: string;
}

/** One plugin of a generation. */
export interface GenerationEntry {
  name: string;
  version: string;
  /** `sha256-<hex>`, the store entry's key. */
  integrity: string;
}

/** The generation `current` names, when the pointer and a complete generation behind it exist. */
export function currentGeneration(root: string): string | null {
  let gen: string;
  try {
    gen = fs.readFileSync(path.join(pluginsDir(root), CURRENT_FILE), "utf8").trim();
  } catch {
    return null;
  }
  if (!GENERATION.test(gen)) return null;
  return fs.existsSync(path.join(pluginsDir(root), gen, COMPLETE_FILE)) ? gen : null;
}

/** The directory of the current generation, or null. */
export function currentGenerationDir(root: string): string | null {
  const gen = currentGeneration(root);
  return gen === null ? null : path.join(pluginsDir(root), gen);
}

/** The plugins a generation holds, from its package.json; null when it is not a generation. */
export async function readGeneration(root: string, gen: string): Promise<GenerationEntry[] | null> {
  let manifest: { plugins?: unknown };
  try {
    manifest = JSON.parse(
      await fsp.readFile(path.join(pluginsDir(root), gen, "package.json"), "utf8"),
    ) as { plugins?: unknown };
  } catch {
    return null;
  }
  const table = manifest.plugins;
  if (table === null || typeof table !== "object") return null;
  const out: GenerationEntry[] = [];
  for (const [name, row] of Object.entries(table as Record<string, unknown>)) {
    const r = row as { version?: unknown; sha256?: unknown };
    if (typeof r.version !== "string" || typeof r.sha256 !== "string") continue;
    out.push({ name, version: r.version, integrity: `sha256-${r.sha256}` });
  }
  return out;
}

const hexOf = (integrity: string) => integrity.replace(/^sha256-/, "");
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The key of a selection: the hash of its sorted (name, sha256) list, 16 hex digits. */
export function generationKey(entries: readonly GenerationEntry[]): string {
  const pairs = entries
    .map((e) => [e.name, hexOf(e.integrity)] as const)
    .sort(([a], [b]) => byCodeUnit(a, b));
  return createHash("sha256").update(JSON.stringify(pairs)).digest("hex").slice(0, 16);
}

/**
 * `node_modules/<name>` → the store entry's package. A junction on Windows (no privilege
 * needed), a directory symlink elsewhere; a copy when the filesystem allows neither.
 */
async function linkPackage(target: string, link: string): Promise<void> {
  await fsp.mkdir(path.dirname(link), { recursive: true });
  try {
    await fsp.symlink(target, link, "junction");
  } catch {
    await fsp.cp(target, link, { recursive: true });
  }
}

/**
 * Writes the generation holding `entries` — unless it already exists — and answers its key.
 * Built in `plugins/.tmp-<pid>/`, marked complete, then renamed into place.
 */
export async function writeGeneration(
  root: string,
  entries: readonly GenerationEntry[],
): Promise<string> {
  const gen = generationKey(entries);
  const dest = path.join(pluginsDir(root), gen);
  if (fs.existsSync(path.join(dest, COMPLETE_FILE))) return gen;
  const tmp = path.join(pluginsDir(root), `.tmp-${process.pid}`);
  await fsp.rm(tmp, { recursive: true, force: true });
  await fsp.mkdir(tmp, { recursive: true });
  try {
    const sorted = [...entries].sort((a, b) => byCodeUnit(a.name, b.name));
    const manifest = {
      name: "penguin-plugins-generation",
      private: true,
      version: "0.0.0",
      dependencies: Object.fromEntries(sorted.map((e) => [e.name, e.version])),
      plugins: Object.fromEntries(
        sorted.map((e) => [e.name, { version: e.version, sha256: hexOf(e.integrity) }]),
      ),
    };
    await fsp.writeFile(path.join(tmp, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    for (const e of sorted) {
      const target = path.join(storeEntryDir(root, e.name, e.version, e.integrity), PACKAGE_DIR);
      await linkPackage(target, path.join(tmp, "node_modules", ...e.name.split("/")));
    }
    await fsp.writeFile(path.join(tmp, COMPLETE_FILE), `${new Date().toISOString()}\n`);
    // A directory without the marker is a write that did not finish: replaced, not trusted.
    await fsp.rm(dest, { recursive: true, force: true });
    await fsp.rename(tmp, dest);
    return gen;
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

/** Points `current` at `gen` (null removes the pointer): a temporary file renamed over it. */
export async function pointCurrent(root: string, gen: string | null): Promise<void> {
  const file = path.join(pluginsDir(root), CURRENT_FILE);
  if (gen === null) {
    await fsp.rm(file, { force: true });
    return;
  }
  await fsp.mkdir(pluginsDir(root), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, `${gen}\n`);
  await fsp.rename(tmp, file);
}

/** `1.2.3-rc.1` as numbers and a prerelease tag; null when it is not a version. */
function parseVersion(v: string): { nums: [number, number, number]; pre: string } | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v.trim());
  if (m === null) return null;
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? "" };
}

/** Semver order; a version that does not parse sorts below every one that does. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (pa === null || pb === null) return pa === null ? (pb === null ? byCodeUnit(a, b) : -1) : 1;
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i]! - pb.nums[i]!;
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === "") return 1;
  if (pb.pre === "") return -1;
  return byCodeUnit(pa.pre, pb.pre);
}

/**
 * Whether `version` satisfies `range`: `*` / empty / `latest`, an exact version, `^`, `~`, the
 * comparators `>=` `>` `<=` `<` `=`, and space-separated conjunctions of those. A range outside
 * that grammar satisfies nothing, which the resolution reports rather than guesses at.
 */
export function satisfies(version: string, range: string | undefined): boolean {
  const r = (range ?? "*").trim();
  if (r === "" || r === "*" || r === "latest" || r === "x") return true;
  const v = parseVersion(version);
  if (v === null) return false;
  return r.split(/\s+/).every((part) => {
    const m = /^(\^|~|>=|<=|>|<|=)?(.+)$/.exec(part);
    if (m === null) return false;
    const op = m[1] ?? "=";
    const base = parseVersion(m[2]!);
    if (base === null) return false;
    const cmp = compareVersions(version, m[2]!);
    // A prerelease satisfies only a range that names a prerelease of the same version.
    if (v.pre !== "" && (base.pre === "" || v.nums.join(".") !== base.nums.join("."))) return false;
    switch (op) {
      case "=":
        return cmp === 0;
      case ">=":
        return cmp >= 0;
      case ">":
        return cmp > 0;
      case "<=":
        return cmp <= 0;
      case "<":
        return cmp < 0;
      case "~":
        return cmp >= 0 && v.nums[0] === base.nums[0] && v.nums[1] === base.nums[1];
      case "^": {
        if (cmp < 0) return false;
        const [M, m2] = base.nums;
        if (M !== 0) return v.nums[0] === M;
        if (m2 !== 0) return v.nums[0] === 0 && v.nums[1] === m2;
        return v.nums.join(".") === base.nums.join(".");
      }
      default:
        return false;
    }
  });
}

/**
 * The store entry a name resolves to, or why none does: a pinned integrity takes that entry;
 * otherwise, among the entries every ask's version admits, what the running build carries
 * (`shipped`, by integrity) before anything else, then the highest version.
 */
export function chooseEntry(
  name: string,
  asks: readonly PluginAsk[],
  stored: readonly StoreIndexEntry[],
  shipped: ReadonlySet<string>,
): StoreIndexEntry | { missing: string } {
  const mine = stored.filter((e) => e.name === name);
  if (mine.length === 0) {
    return {
      missing: `'${name}' is not in the plugin store: install it, or ship it with the build`,
    };
  }
  const pins = [...new Set(asks.map((a) => a.integrity).filter((i): i is string => !!i))];
  if (pins.length > 1) {
    return {
      missing: `'${name}' is pinned to ${pins.length} different contents: ${pins.join(", ")}`,
    };
  }
  const fits = mine.filter(
    (e) =>
      asks.every((a) => satisfies(e.version, a.version)) &&
      (pins.length === 0 || e.integrity === pins[0]),
  );
  if (fits.length === 0) {
    const wanted = asks.map((a) => a.integrity ?? a.version ?? "*").join(", ");
    return {
      missing: `no stored '${name}' satisfies ${wanted} (stored: ${mine.map((e) => e.version).join(", ")})`,
    };
  }
  return [...fits].sort(
    (a, b) =>
      Number(shipped.has(b.integrity)) - Number(shipped.has(a.integrity)) ||
      compareVersions(b.version, a.version) ||
      byCodeUnit(a.integrity, b.integrity),
  )[0]!;
}

/** What one activation did: the generation before it, the one now current, and what could not be placed in it. */
export interface Activation {
  previous: string | null;
  current: string;
  /** name → why it is not in the generation. */
  missing: Map<string, string>;
}

/**
 * Resolves the closure against the store, writes that generation if it is new and points
 * `current` at it. The store is brought up to date with this boot's own sources first (their
 * entries are what "the running build carries" means). `asks` maps each listed package name to
 * what every Project asks of it; a path (a dev checkout's plugin) is not a store name and is
 * left to the loader.
 */
export async function activatePlugins(
  root: string,
  asks: ReadonlyMap<string, readonly PluginAsk[]>,
  assetsDir: string | null,
): Promise<Activation> {
  const shipped = new Set(
    (await shippedEntries(root, storeSources(assetsDir))).map((e) => e.integrity),
  );
  const stored = await readStore(root);
  const chosen: GenerationEntry[] = [];
  const missing = new Map<string, string>();
  for (const [name, list] of asks) {
    if (path.isAbsolute(name)) continue;
    const pick = chooseEntry(name, list, stored, shipped);
    if ("missing" in pick) missing.set(name, pick.missing);
    else chosen.push({ name: pick.name, version: pick.version, integrity: pick.integrity });
  }
  const previous = currentGeneration(root);
  const current = await writeGeneration(root, chosen);
  if (current !== previous) await pointCurrent(root, current);
  return { previous, current, missing };
}

/**
 * Where a name in the current generation came from (the store entry's `.stored`), or null when
 * the generation does not hold it.
 */
export async function generationSource(root: string, name: string): Promise<StoreSource | null> {
  const gen = currentGeneration(root);
  if (gen === null) return null;
  const entry = (await readGeneration(root, gen))?.find((e) => e.name === name);
  if (entry === undefined) return null;
  try {
    const stored = parseToml(
      await fsp.readFile(
        path.join(storeEntryDir(root, entry.name, entry.version, entry.integrity), STORED_FILE),
        "utf8",
      ),
    );
    const source = stored.source;
    return source === "push" || source === "builtin" || source === "registry" ? source : null;
  } catch {
    return null;
  }
}
