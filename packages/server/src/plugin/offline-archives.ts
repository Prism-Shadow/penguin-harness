/**
 * Offline archives: plugins that live in this repository and are listed in the market but are not
 * shipped with the build (not preinstalled, not in the builtin prefix — Computer Use), carried
 * by the build as the tarballs `npm pack` would publish, so the market can install them with no
 * registry at all: before the package is published, offline, or where the registry is slow or
 * blocked (05 「插件库」 「安装从不卡住」).
 *
 * An archive is not an install: nothing here lists, loads or preinstalls it. The install route
 * reaches for one only when npm could not serve the name (plugins-installed.ts), verifies it
 * against the sha512 recorded beside it, and installs it through the zip import's own path.
 *
 * WHERE THEY ARE. scripts/build-plugins.mjs stages them in the builtin prefix it builds, under
 * `offline/`: the tarball, a folder of the package's own `package.json` and `ifaces.json` (what
 * it carries, read by core's one rule without unpacking anything), and `offline/index.json`
 * naming each. The prefix travels wherever the builtin plugins do (a push's assets, the desktop
 * app, a release), so the archives travel with it. A workspace checkout has no builtin prefix:
 * there the repository's own `plugins/<name>/` is packed when an install needs it, which is the
 * same bytes the build would have carried.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasLibraryContributions, readPluginTable } from "@prismshadow/penguin-core";
import builtinIndex from "./builtin-index.json" with { type: "json" };
import { packPackageDirectory } from "./install.js";
import { resolvePluginPackage, type PluginBase } from "./loader.js";
import { checkoutRoot } from "../services/cli-shim.js";
import { profileFromEnv } from "../machines/layout.js";

/** The folder under a builtin prefix that holds the archives, and its index. */
export const OFFLINE_DIR = "offline";
export const OFFLINE_INDEX = "index.json";

/** One offline archive: what it is, what it carries, and how to get its verified bytes. */
export interface OfflineArchive {
  name: string;
  version: string;
  /** It carries something an install writes into an Agent (Skills, hooks, MCP servers, workbenches). */
  library: boolean;
  /** It lists server modules. */
  modules: boolean;
  /** The tarball on this machine and the sha512 it must match (`sha512-<base64>`). */
  tarball(): Promise<{ file: string; integrity: string }>;
}

/** A row of `offline/index.json`, as the build writes it. */
interface IndexRow {
  name: string;
  version: string;
  /** The tarball, relative to `offline/`. */
  file: string;
  integrity: string;
  /** The folder holding the package's own package.json and ifaces.json, relative to `offline/`. */
  meta: string;
}

function isRow(v: unknown): v is IndexRow {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  const rel = (x: unknown) =>
    typeof x === "string" && x !== "" && !path.isAbsolute(x) && !x.split(/[\\/]/).includes("..");
  return (
    typeof r.name === "string" &&
    typeof r.version === "string" &&
    typeof r.integrity === "string" &&
    r.integrity.startsWith("sha512-") &&
    rel(r.file) &&
    rel(r.meta)
  );
}

/** What a package folder carries, by core's rule (plugin/kinds.ts), reading only its table. */
function carried(dir: string): { library: boolean; modules: boolean } {
  try {
    const table = readPluginTable(dir);
    if (table === null) return { library: false, modules: false };
    return {
      library: hasLibraryContributions(table),
      modules: table.plugin.modules.length + table.plugin.replaces.length > 0,
    };
  } catch {
    return { library: false, modules: false };
  }
}

/** The archives one builtin prefix carries (its `offline/index.json`); none when it has none. */
function prefixArchives(prefixDir: string): OfflineArchive[] {
  const dir = path.join(prefixDir, OFFLINE_DIR);
  let rows: unknown;
  try {
    rows = JSON.parse(readFileSync(path.join(dir, OFFLINE_INDEX), "utf8"));
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];
  return rows.filter(isRow).map((row) => ({
    name: row.name,
    version: row.version,
    ...carried(path.join(dir, row.meta)),
    tarball: () => Promise.resolve({ file: path.join(dir, row.file), integrity: row.integrity }),
  }));
}

/** The names the market lists from this package's own index (builtin-index.json). */
const marketNames = (): Set<string> =>
  new Set((builtinIndex as Array<{ name?: unknown }>).map((e) => String(e.name)));

/**
 * A workspace checkout's archives: each `plugins/<dir>/` whose package the market lists and no
 * builtin base ships, packed by npm when an install asks for its bytes (the plugin must have been
 * built — `pnpm -r build` precedes `pnpm dev`).
 */
function workspaceArchives(repo: string, bases: readonly PluginBase[]): OfflineArchive[] {
  const listed = marketNames();
  const out: OfflineArchive[] = [];
  const pluginsDir = path.join(repo, "plugins");
  let dirs: string[];
  try {
    dirs = readdirSync(pluginsDir);
  } catch {
    return [];
  }
  for (const entry of dirs.sort()) {
    const dir = path.join(pluginsDir, entry);
    let pkg: { name?: unknown; version?: unknown };
    try {
      pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as typeof pkg;
    } catch {
      continue;
    }
    if (typeof pkg.name !== "string" || typeof pkg.version !== "string") continue;
    if (!listed.has(pkg.name)) continue;
    // Shipped with the build: installing it is a list edit, never an archive.
    const shipped = resolvePluginPackage(pkg.name, bases);
    if (shipped !== null && shipped.base.builtin) continue;
    if (!existsSync(path.join(dir, "ifaces.json"))) continue;
    const name = pkg.name;
    const version = pkg.version;
    out.push({
      name,
      version,
      ...carried(dir),
      tarball: () => packWorkspacePlugin(dir),
    });
  }
  return out;
}

/** Packs a checkout's plugin directory the way the build does, into a fresh temporary folder. */
async function packWorkspacePlugin(dir: string): Promise<{ file: string; integrity: string }> {
  const into = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-offline-"));
  const file = await packPackageDirectory(dir, into);
  return { file, integrity: await integrityOf(file) };
}

/** `sha512-<base64>` of a file, npm's integrity shape. */
export async function integrityOf(file: string): Promise<string> {
  return `sha512-${createHash("sha512")
    .update(await fs.readFile(file))
    .digest("base64")}`;
}

/**
 * The workspace checkout a dev server runs from (`pnpm dev`, the dev profile), or null: an npm
 * install and the desktop app have no checkout, and a release-profile run from one (the tests, a
 * hand-started build) reads only what a build carries.
 */
const checkout = (): string | null =>
  profileFromEnv(process.env) === "dev"
    ? checkoutRoot(path.dirname(fileURLToPath(import.meta.url)))
    : null;

/**
 * Every offline archive this server can install from: the builtin prefixes' (in base order, the
 * first naming a package winning), else, in a workspace checkout, the repository's own.
 */
export function offlineArchives(
  bases: readonly PluginBase[],
  repo: string | null = checkout(),
): OfflineArchive[] {
  const out: OfflineArchive[] = [];
  const seen = new Set<string>();
  for (const base of bases) {
    if (!base.builtin || base.program === true) continue;
    for (const archive of prefixArchives(path.dirname(base.file))) {
      if (seen.has(archive.name)) continue;
      seen.add(archive.name);
      out.push(archive);
    }
  }
  if (out.length === 0 && repo !== null) return workspaceArchives(repo, bases);
  return out;
}

/**
 * The archive an install of `name` (at `version`, when one was asked for) may come from, or null.
 * A version request is met only by that exact version, or by a tag/range the archive's own
 * version is the obvious answer to (`latest`, `*`, empty).
 */
export function offlineArchiveFor(
  archives: readonly OfflineArchive[],
  name: string,
  version?: string,
): OfflineArchive | null {
  const archive = archives.find((a) => a.name === name);
  if (archive === undefined) return null;
  if (version === undefined || version === "" || version === "latest" || version === "*") {
    return archive;
  }
  return archive.version === version.replace(/^[=v]/, "") ? archive : null;
}
