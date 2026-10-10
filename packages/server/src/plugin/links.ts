/**
 * The LOCAL plugin links: the record of the local directories a machine's plugin names are
 * linked to, and what a name so linked resolves to.
 *
 * `<root>/plugin-links.json` holds one row per package name, each naming where the
 * directory is, when it was linked and by whom — the provenance the installed-plugins list
 * shows on the row. A link is a fact about THIS machine's file system, like the plugin
 * store: one record per name, machine-wide, and the record is an input to activation
 * (plugin/activation.ts), which links `node_modules/<name>` to the directory in every
 * generation it writes. Nothing is ever placed in a generation by hand — a link that
 * survived there would be wiped by the next activation, so the record is the link.
 *
 * A local directory has NO INTEGRITY. The store keys an entry by npm's `dist.integrity`
 * (plugin/store.ts); a linked name is keyed by its path, and what its directory holds is
 * what runs — a rebuild changes the content under an unchanged key, which is the point of
 * linking a source directory and the reason an integrity pin on a linked name is refused
 * rather than ignored. The version is read live from the directory's own package.json, at
 * enable time and again at each activation, so a Project's version range is checked against
 * what is actually there.
 *
 * The enable operation validates the directory BEFORE linking it: a path that is not
 * absolute, a directory that does not exist, a package.json without a name and a version,
 * or an entry file that is not there (the file a build produces — `dist/`, for the examples)
 * is refused with its reason, so a name is never listed that could not load. The same
 * checks run again at each activation — a directory can be rebuilt, moved or removed after
 * it was linked — and a name that no longer passes is reported on its row with why, like
 * any name the store cannot answer.
 */
import { existsSync } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { satisfies } from "../api/plugin-pick.js";
import { PACKAGE_NAME, packageEntry } from "./loader.js";
import type { GenerationEntry, PluginAsk } from "./activation.js";

/** The record file, at the data root: `<root>/plugin-links.json`. */
export const LINKS_FILE = "plugin-links.json";

/** One recorded link: the provenance of a name that resolves to a local directory. */
export interface PluginLink {
  /** The directory the name is linked to, as it was named when the link was made. */
  path: string;
  /** When the link was made, ISO 8601. */
  linkedAt: string;
  /** Who made it, the operating user's id. */
  by: string;
}

/** Every recorded link, keyed by package name. */
export type PluginLinks = Map<string, PluginLink>;

export function pluginLinksFile(root: string): string {
  return path.join(root, LINKS_FILE);
}

/**
 * Every recorded link, or none when the file is absent. A file that cannot be read or
 * parsed is logged and answers none — a boot must not fail over it, and a linked name then
 * reports on its row why it cannot be placed, the way an unreadable Project config does
 * (plugin/loader.ts).
 */
export async function readPluginLinks(root: string): Promise<PluginLinks> {
  let text: string;
  try {
    text = await fsp.readFile(pluginLinksFile(root), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(
        `[plugin-links] ${LINKS_FILE} could not be read, no name is linked: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return new Map();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    console.warn(
      `[plugin-links] ${LINKS_FILE} is not valid JSON, no name is linked: ${err instanceof Error ? err.message : String(err)}`,
    );
    return new Map();
  }
  const out: PluginLinks = new Map();
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return out;
  for (const [name, row] of Object.entries(parsed as Record<string, unknown>)) {
    if (!PACKAGE_NAME.test(name) || row === null || typeof row !== "object") continue;
    const r = row as { path?: unknown; linkedAt?: unknown; by?: unknown };
    if (typeof r.path !== "string" || typeof r.linkedAt !== "string" || typeof r.by !== "string") {
      continue;
    }
    out.set(name, { path: r.path, linkedAt: r.linkedAt, by: r.by });
  }
  return out;
}

/**
 * Writes the whole record atomically — a temporary file renamed over the old one, the same
 * discipline the activation pointer takes — so a reader sees the whole old record or the
 * whole new one.
 */
export async function writePluginLinks(root: string, links: PluginLinks): Promise<void> {
  const file = pluginLinksFile(root);
  const body = `${JSON.stringify(Object.fromEntries([...links].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))), null, 2)}\n`;
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(tmp, body);
  await fsp.rename(tmp, file);
}

/**
 * The plugin package a directory holds, checked the way a load would read it: an absolute
 * path, an existing directory, a package.json naming a package (`PACKAGE_NAME`) with a
 * version, and the entry file a load would import (the package's `exports` or `main`, the
 * file its build produces). An unbuilt source directory — `dist/` not made, `ifaces.json`
 * not generated — fails here at the entry file, before anything is linked or listed.
 */
async function readLocalPackage(
  dir: string,
): Promise<{ name: string; version: string; entry: string } | { error: string }> {
  if (typeof dir !== "string" || dir.trim() === "") {
    return { error: "the plugin directory must be named by its absolute path" };
  }
  if (!path.isAbsolute(dir)) {
    return { error: `'${dir}' is not an absolute path: a local plugin directory is named by its absolute path` };
  }
  let stat: Awaited<ReturnType<typeof fsp.stat>>;
  try {
    stat = await fsp.stat(dir);
  } catch {
    return { error: `'${dir}' does not exist` };
  }
  if (!stat.isDirectory()) {
    return { error: `'${dir}' is not a directory` };
  }
  const manifest = path.join(dir, "package.json");
  let pkg: { name?: unknown; version?: unknown };
  try {
    pkg = JSON.parse(await fsp.readFile(manifest, "utf8")) as typeof pkg;
  } catch {
    return { error: `${dir}: no readable package.json with a package name and a version — not a plugin package` };
  }
  const name = typeof pkg.name === "string" ? pkg.name : null;
  const version = typeof pkg.version === "string" ? pkg.version : null;
  if (name === null || version === null || !PACKAGE_NAME.test(name)) {
    return { error: `${dir}: no readable package.json with a package name and a version — not a plugin package` };
  }
  const entry = packageEntry(dir, manifest);
  if (entry === null || !existsSync(entry)) {
    return {
      error:
        entry === null
          ? `${dir}: its package.json declares no entry file`
          : `the package's entry file does not exist: ${entry} — build the package first (the file its main/exports names is a build product)`,
    };
  }
  return { name, version, entry };
}

/**
 * What an enable would link: the directory validated as a plugin package, and the name it
 * gives itself — the name that gets listed in the Project's table, so what loads still
 * loads by name and never by path.
 */
export async function inspectLocalPlugin(
  dir: string,
): Promise<{ name: string; version: string } | { error: string }> {
  return readLocalPackage(dir);
}

/**
 * What a linked name resolves to at an activation: the directory read again, live — its
 * version is what its package.json says now, checked against what the Projects ask of the
 * name. An integrity pin is refused outright (a local directory has none); a version range
 * the directory's own version does not satisfy is refused with both named. A directory
 * that no longer passes is reported with why, and the rest of the generation is placed as
 * usual.
 */
export async function resolveLocalEntry(
  name: string,
  link: PluginLink,
  asks: readonly PluginAsk[],
): Promise<GenerationEntry | { missing: string }> {
  const read = await readLocalPackage(link.path);
  if ("error" in read) {
    return {
      missing: `'${name}' is linked locally at ${link.path}, which is no longer a loadable plugin package: ${read.error}`,
    };
  }
  if (read.name !== name) {
    return {
      missing: `'${name}' is linked locally at ${link.path}, whose package.json names '${read.name}' — link the directory of the package itself`,
    };
  }
  const pin = asks.find((a) => a.integrity !== undefined)?.integrity;
  if (pin !== undefined) {
    return {
      missing: `'${name}' is pinned to ${pin}, but it is linked locally at ${link.path}: a local directory has no integrity to pin`,
    };
  }
  const wanted = asks.map((a) => a.version ?? "*").join(", ");
  if (!asks.every((a) => a.version === undefined || satisfies(read.version, a.version))) {
    return {
      missing: `the local '${name}' at ${link.path} is version ${read.version}, which does not satisfy ${wanted}`,
    };
  }
  return { name, version: read.version, local: link.path };
}
