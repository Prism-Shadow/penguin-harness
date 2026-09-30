/**
 * Plugin packages on disk, in the shape a built plugin has: a `package.json`, the
 * generated `ifaces.json` beside it (the module payload), and an entry whose default export
 * names the module classes. Plugin source is written the way a plugin author writes it
 * and lowered the way its build would lower it, so the fixture exercises the same
 * decorators the host reads.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { stringify as stringifyToml } from "smol-toml";
import ts from "typescript";
import { layOutEntry, sortIndex } from "../../../scripts/plugin-entry.mjs";

/**
 * The decorators, as a plugin's bundle would carry them — here imported from this
 * checkout's built SDK by file URL, since a package under a temp dir resolves nothing.
 */
export const decorators = new URL("../../core/dist/plugin/index.js", import.meta.url).href;

/** Plugin source as a plugin author writes it, lowered the way its build would lower it. */
export function lower(source: string): string {
  return ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
}

export interface ClassPackage {
  name: string;
  /** The one module class the package exports (a `@Module()` with nothing to require or provide). */
  module: string;
  /** package.json `version`; default `1.0.0` (the plugin store keys an entry by name and version). */
  version?: string;
  /** package.json `main`; default `./index.js`. */
  main?: string;
  /** package.json `exports`, when the package declares them. */
  exports?: unknown;
  /** The entry's source, when it is not the default class (a package that throws on import, say). */
  index?: string;
}

/** Writes one plugin package into `dir` and returns its entry file. */
export async function writeClassPackage(dir: string, pkg: ClassPackage): Promise<string> {
  const main = pkg.main ?? "./index.js";
  const entry = path.join(dir, main);
  await mkdir(path.dirname(entry), { recursive: true });
  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: pkg.name,
      version: pkg.version ?? "1.0.0",
      type: "module",
      main,
      ...(pkg.exports !== undefined ? { exports: pkg.exports } : {}),
    }),
    "utf8",
  );
  await writeFile(
    path.join(dir, "ifaces.json"),
    JSON.stringify({
      ifaces: {},
      types: {},
      modules: {
        [pkg.module]: {
          name: pkg.module,
          requires: {},
          provides: {},
          contributes: {},
          children: [],
        },
      },
      plugin: { modules: [pkg.module], replaces: [] },
    }),
    "utf8",
  );
  await writeFile(
    entry,
    pkg.index ??
      lower(`import { Module } from ${JSON.stringify(decorators)};
             @Module() export class ${pkg.module} {}
             export default { modules: [${pkg.module}] };`),
    "utf8",
  );
  return entry;
}

/**
 * Rebuilds a shipped prefix's `index.json` the way scripts/build-plugins.mjs does: every package
 * the prefix's own package.json names, laid out as an entry to learn its integrity.
 */
export async function writeShippedIndex(prefix: string): Promise<void> {
  const manifest = JSON.parse(await readFile(path.join(prefix, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const index = [];
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    const stage = await mkdtemp(path.join(tmpdir(), "shipped-entry-"));
    try {
      const pkgDir = path.join(prefix, "node_modules", ...name.split("/"));
      index.push((await layOutEntry(stage, pkgDir, prefix, { stringifyToml })).manifest);
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  }
  await writeFile(path.join(prefix, "index.json"), JSON.stringify(sortIndex(index)));
}
