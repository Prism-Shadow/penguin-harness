/**
 * A plugin package's generated table, `ifaces.json` beside its `package.json`: what `gen-ifaces`
 * reads statically off the package's decorated classes — the manifest of every module (its
 * requires, provides, contributes and children) and the signature of every interface they name —
 * plus the `plugin` entry, the classes its default export lists. The host reads it without running
 * the package: the server's loader to boot a plugin's modules, the library to read what a plugin
 * carries for an Agent (./contributions.ts).
 *
 * What a package IS follows from its table (./kinds.ts), never from which directories it has.
 */
import fs from "node:fs";
import path from "node:path";
import { parseManifest } from "../kernel/manifest.js";
import type { ManifestTable } from "../kernel/module.js";
import type { IfaceTable } from "../kernel/sig.js";

/** The generated table a plugin package ships beside its package.json. */
export const IFACES_FILE = "ifaces.json";

/** The `plugin` entry of a package's table: the names its default export lists, read statically by the generator. */
export interface PluginDeclaration {
  modules: readonly string[];
  replaces: readonly string[];
}

/** A package's table, read and checked. */
export interface PluginTable {
  /** The `ifaces.json` it was read from. */
  file: string;
  ifaces: IfaceTable;
  manifests: ManifestTable;
  /** What the default export names: the modules added and the nodes stood in for. */
  plugin: PluginDeclaration;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads the table of the package at `dir`. Null when the package has no `ifaces.json` (it was
 * never built); throws, naming the file, when the table will not read — not JSON, not the
 * generator's shape, a module manifest the kernel refuses.
 */
export function readPluginTable(dir: string): PluginTable | null {
  const file = path.join(dir, IFACES_FILE);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  let table: { ifaces?: unknown; types?: unknown; modules?: unknown; plugin?: unknown };
  try {
    table = JSON.parse(text) as typeof table;
  } catch {
    throw new Error(`${file}: not valid JSON`);
  }
  if (
    !isRecord(table) ||
    !isRecord(table.ifaces) ||
    !isRecord(table.types) ||
    !isRecord(table.modules)
  ) {
    throw new Error(`${file}: expected { ifaces, types, modules } (gen-ifaces output)`);
  }
  const names = (v: unknown) => Array.isArray(v) && v.every((n) => typeof n === "string");
  const plugin = (table.plugin ?? {}) as { modules?: unknown; replaces?: unknown };
  if (!isRecord(plugin) || !names(plugin.modules ?? []) || !names(plugin.replaces ?? [])) {
    throw new Error(`${file}#plugin: expected { modules: [<name>, …], replaces: [<name>, …] }`);
  }
  const manifests: Record<string, ManifestTable[string]> = {};
  for (const [name, doc] of Object.entries(table.modules)) {
    manifests[name] = parseManifest(doc, `${file}#modules.${name}`);
  }
  return {
    file,
    ifaces: { ifaces: table.ifaces, types: table.types } as IfaceTable,
    manifests,
    plugin: {
      modules: (plugin.modules ?? []) as string[],
      replaces: (plugin.replaces ?? []) as string[],
    },
  };
}

/**
 * The file an `import "<name>"` of the package at `dir` would load: `exports["."]` — a string, or
 * its `import` / `node` / `default` condition — else `main` (with `.js` supplied when it is written
 * without one), else `index.js`. Null when the package.json will not read. The file may not
 * exist: a package that carries only content has no entry at all.
 */
export function packageEntry(dir: string): string | null {
  let pkg: { exports?: unknown; main?: unknown };
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as typeof pkg;
  } catch {
    return null;
  }
  const condition = (value: unknown): string | null => {
    if (typeof value === "string") return value;
    if (value === null || typeof value !== "object") return null;
    const v = value as Record<string, unknown>;
    return condition(v.import) ?? condition(v.node) ?? condition(v.default) ?? null;
  };
  let rel: string | null = null;
  const exp = pkg.exports;
  if (typeof exp === "string") rel = exp;
  else if (exp !== null && typeof exp === "object") {
    const table = exp as Record<string, unknown>;
    rel = condition("." in table ? table["."] : table);
  }
  rel ??= typeof pkg.main === "string" ? pkg.main : "./index.js";
  const file = path.resolve(dir, rel);
  if (!fs.existsSync(file) && path.extname(file) === "" && fs.existsSync(`${file}.js`)) {
    return `${file}.js`;
  }
  return file;
}
