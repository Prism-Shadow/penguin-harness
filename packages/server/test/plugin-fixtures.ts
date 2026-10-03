/**
 * Plugin packages on disk, in the shape a built plugin has: a `package.json`, the
 * generated `ifaces.json` beside it (the module payload), and an entry whose default export
 * names the module classes. Plugin source is written the way a plugin author writes it
 * and lowered the way its build would lower it, so the fixture exercises the same
 * decorators the host reads.
 */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as tar from "tar";
import ts from "typescript";
import { afterEach, beforeEach } from "vitest";
import {
  INTEGRITY_FILE,
  manifestOf,
  sortIndex,
  tarballIntegrity,
} from "../../../scripts/plugin-entry.mjs";
import { prefixNames } from "../src/plugin/prefix.js";

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
  /** package.json `version`; default `1.0.0`. */
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
 * A stand-in for a package's npm integrity (`sha512-<base64>` of its tarball), for a fixture's
 * index row or pin. Distinct per name, version and optional `content` tag, the way two packs of
 * different content differ.
 */
export function integrityOf(name: string, version: string, content = ""): string {
  return `sha512-${createHash("sha512").update(`${name}@${version}#${content}`).digest("base64")}`;
}

/**
 * Packs the package directory `pkgDir` the way npm does — its files under `package/`, gzipped —
 * into `file`, and answers the tarball's npm integrity.
 */
export async function packDir(pkgDir: string, file: string): Promise<string> {
  await tar.c(
    // One fixed mtime for every entry, as npm and pnpm write it.
    { gzip: true, file, cwd: pkgDir, prefix: "package", portable: true, mtime: new Date(0) },
    (await readdir(pkgDir)).sort(),
  );
  return tarballIntegrity(file);
}

/**
 * Turns a directory whose `node_modules` holds packages into a bundled plugin directory the way
 * scripts/build-plugins.mjs writes one: each package packed to learn its tarball's integrity,
 * recorded beside it as `.integrity`, and `index.json` a row per package.
 */
export async function writeShippedIndex(prefix: string): Promise<void> {
  const tmp = await mkdtemp(path.join(tmpdir(), "shipped-"));
  try {
    const index = [];
    for (const name of prefixNames(prefix)) {
      const pkgDir = path.join(prefix, "node_modules", ...name.split("/"));
      const pkg = JSON.parse(await readFile(path.join(pkgDir, "package.json"), "utf8")) as {
        version: string;
      } & Record<string, unknown>;
      const integrity = await packDir(pkgDir, path.join(tmp, "p.tgz"));
      await writeFile(path.join(pkgDir, INTEGRITY_FILE), `${integrity}\n`);
      index.push(manifestOf(pkg, name, pkg.version, integrity));
    }
    await writeFile(path.join(prefix, "index.json"), JSON.stringify(sortIndex(index)));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/**
 * A scratch directory per test — `dir`, holding an empty data root `root` — created before each
 * test (and handed to `use`) and removed after it.
 */
export function useScratch(prefix: string, use: (at: { dir: string; root: string }) => void): void {
  let dir = "";
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), prefix));
    await mkdir(path.join(dir, "root"));
    use({ dir, root: path.join(dir, "root") });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
}
