#!/usr/bin/env node
/**
 * The Web App's `gen:ifaces`: writes the generated list of the shipped plugins' web halves
 * (`src/plugin-web.gen.ts`), then the interface table (`src/ifaces.json`) over the app's sources
 * (`tsconfig.app.json`, `src/` only) and those web halves together. With `--tests` it also
 * writes `test/ifaces.json` over the app, its tests and the web halves (`tsconfig.json`): the
 * table a suite boots a test-only module against, which never reaches the shipped bundle.
 *
 * A plugin's web half is a dependency of this package whose package.json exports `./web`: an
 * entry under its `src/web/`, TypeScript source this package's Vite compiles with the app, whose
 * default export is `{ modules: [<@Module class>, …], api?: <its endpoint wrappers> }`. Beside its
 * package.json it keeps `tsconfig.web.json` (DOM and JSX, its `src/web/` only). A library
 * package's web half (`@prismshadow/penguin-library-…`) is collected the same way, but it never
 * joins the generated list — the host boots its module classes from web-root's children.
 * The plugin web halves land in the app's own table, so the boot check judges them with the
 * app's: a workspace package's are read with the app's program, which the generated list leads
 * to them from the package's own directory; a package installed under node_modules, which that
 * program never reads, is read through one more `--project` (the app's compiler options,
 * re-anchored outside node_modules and including the copy's `src/web/`), with the copy's
 * directory handed to the generator as `--project-sources`.
 * web-root.ts boots each listed module beside the app's own.
 *
 *   node scripts/gen-web-table.mjs [--tests] [gen-ifaces flags such as --check]
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Where a plugin's web half must live in its package. */
const WEB_DIR = "./src/web/";

/** The export conditions a browser bundle resolves, in the order a bundler tries them. */
const CONDITIONS = ["import", "browser", "module", "default"];

/** The file an export target names, through nested conditions and fallback arrays; null for none. */
function targetOf(target) {
  if (typeof target === "string") return target;
  if (Array.isArray(target)) {
    for (const option of target) {
      const found = targetOf(option);
      if (found !== null) return found;
    }
    return null;
  }
  if (target !== null && typeof target === "object") {
    for (const condition of CONDITIONS) {
      if (condition in target) {
        const found = targetOf(target[condition]);
        if (found !== null) return found;
      }
    }
  }
  return null;
}

/** The workspace directory of a package named `name` under `pluginsDir`, or null. */
function workspaceDirOf(name, pluginsDir) {
  if (pluginsDir === null || !fs.existsSync(pluginsDir)) return null;
  for (const dir of fs.readdirSync(pluginsDir)) {
    const manifest = path.join(pluginsDir, dir, "package.json");
    if (!fs.existsSync(manifest)) continue;
    if (JSON.parse(fs.readFileSync(manifest, "utf8")).name === name) {
      return path.join(pluginsDir, dir);
    }
  }
  return null;
}

/**
 * The web halves among `webDir`'s dependencies, in the order its package.json lists them: each
 * package's name, the specifier the app imports it by, and the tsconfig its modules are read
 * through. `pluginsDir` is where the workspace keeps plugin packages (the repository's
 * `plugins/`); a dependency found there is read from there. A listed dependency that is not
 * installed is an error, not a web half to skip: whether it has one cannot be told.
 */
export function pluginWebEntries(webDir, { pluginsDir = null } = {}) {
  const manifest = JSON.parse(fs.readFileSync(path.join(webDir, "package.json"), "utf8"));
  const entries = [];
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    const installed = path.join(webDir, "node_modules", name, "package.json");
    if (!fs.existsSync(installed)) {
      throw new Error(
        `${name}: listed in the Web App's dependencies but not installed; run pnpm install`,
      );
    }
    const pkg = JSON.parse(fs.readFileSync(installed, "utf8"));
    const declared = pkg.exports?.["./web"];
    if (declared === undefined) continue;
    const entry = targetOf(declared);
    if (entry === null) {
      throw new Error(
        `${name}: exports["./web"] names no file under a condition a browser build resolves`,
      );
    }
    if (!entry.startsWith(WEB_DIR)) {
      throw new Error(
        `${name}: exports["./web"] is ${entry}; a plugin's web half lives under ${WEB_DIR}`,
      );
    }
    // A workspace package is read from its own directory; an installed copy — an injected
    // workspace package or a package from the registry — through the copy pnpm put in
    // node_modules, which is the only place its files exist.
    const dir = workspaceDirOf(name, pluginsDir) ?? fs.realpathSync(path.dirname(installed));
    const tsconfig = path.join(dir, "tsconfig.web.json");
    if (!fs.existsSync(tsconfig)) {
      throw new Error(`${name}: has a web half but no tsconfig.web.json beside its package.json`);
    }
    entries.push({
      name,
      specifier: `${name}/web`,
      tsconfig,
      // A library package's web half (library/<domain>, its `./web` entry) is not a shipped
      // plugin's: the host compiles it with its own program and boots its module classes from
      // web-root's children, so it never joins the generated plugin list — but its modules are
      // read through a separate project all the same when only an installed copy of the
      // package exists, exactly like a shipped plugin's.
      library: name.startsWith("@prismshadow/penguin-library-"),
    });
  }
  return entries;
}

/**
 * The entries the interface generator must read through a project of their own: a package whose
 * files sit under node_modules — an installed copy — which the generator never reads from the
 * app's program. A workspace package (linked from plugins/ or library/) is already in the app's
 * program: the generated list imports it (or web-root's children do), and its files are outside
 * node_modules, so they are read with the app's. Handing its tsconfig over as well would read
 * every file twice, and the second read fails the generator.
 */
export function separateProjects(entries) {
  return entries.filter((e) => e.tsconfig.split(path.sep).includes("node_modules"));
}

/**
 * The project handed to the generator for a separate entry: the app's compiler options
 * re-anchored under this package (an installed copy's own tsconfig.web.json extends a relative
 * path that only holds in its workspace) and including the copy's web half by absolute path.
 */
function separateProjectConfig(webDir, entry) {
  const dir = path.join(webDir, "node_modules", ".cache", "gen-web-table");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(
    dir,
    `${entry.name.replaceAll(/[^a-zA-Z0-9.-]/g, "_")}.tsconfig.json`,
  );
  const text = `${JSON.stringify(
    {
      extends: path.join(webDir, "tsconfig.json"),
      include: [path.join(path.dirname(entry.tsconfig), WEB_DIR)],
    },
    null,
    2,
  )}\n`;
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== text) fs.writeFileSync(file, text);
  return file;
}

/** The generated list's source for `entries`: the shipped plugins' halves only — a library
 * package's web half boots from web-root's children, not from this list. */
export function pluginWebModuleSource(entries) {
  const listed = entries.filter((e) => !e.library);
  const lines = [
    "/**",
    " * Generated by scripts/gen-web-table.mjs: the web halves of the shipped plugins this package",
    ' * depends on (each package\'s `exports["./web"]`), in the order its package.json lists them.',
    " * Do not edit; `pnpm gen:ifaces` writes it.",
    " */",
    'import type { ModuleClass } from "@prismshadow/penguin-core/kernel";',
  ];
  listed.forEach((entry, i) => lines.push(`import plugin${i} from "${entry.specifier}";`));
  lines.push(
    "",
    "/** One plugin's web half: its package, and what its `./web` entry exports. */",
    "export interface PluginWebEntry {",
    "  package: string;",
    "  plugin: {",
    "    readonly modules: readonly ModuleClass[];",
    "    /** Its endpoint wrappers: the gallery's mock coverage check calls every one. */",
    "    readonly api?: Readonly<Record<string, unknown>>;",
    "  };",
    "}",
    "",
    "export const pluginWebModules: readonly PluginWebEntry[] = [",
  );
  listed.forEach((entry, i) =>
    lines.push(`  { package: ${JSON.stringify(entry.name)}, plugin: plugin${i} },`),
  );
  lines.push("];");
  return `${lines.join("\n")}\n`;
}

/** Writes the list under `webDir` when it changed; answers the entries. */
export function writePluginWebModules(webDir, options) {
  const entries = pluginWebEntries(webDir, options);
  const out = path.join(webDir, "src", "plugin-web.gen.ts");
  const text = pluginWebModuleSource(entries);
  if (!fs.existsSync(out) || fs.readFileSync(out, "utf8") !== text) fs.writeFileSync(out, text);
  return entries;
}

/** Runs the interface generator with `args` (the `--project`/`--project-sources` pairs included)
 * into `out`; answers its exit status. */
function genIfaces(webDir, args, out, flags) {
  const result = spawnSync(
    process.execPath,
    [
      path.resolve(webDir, "..", "..", "scripts", "gen-ifaces.mjs"),
      ...args,
      "--out",
      out,
      ...flags,
    ],
    { cwd: webDir, stdio: "inherit" },
  );
  return result.status ?? 1;
}

/** The generator's project arguments: the app's project, then one derived project and its own
 * sources' directory for every separate entry. */
function genIfacesProjects(webDir, entries) {
  return [
    "tsconfig.app.json",
    ...separateProjects(entries).flatMap((e) => [
      "--project",
      path.relative(webDir, separateProjectConfig(webDir, e)),
      "--project-sources",
      path.dirname(e.tsconfig),
    ]),
  ];
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const webDir = path.resolve(here, "..");
  const args = process.argv.slice(2);
  const withTests = args.includes("--tests");
  const flags = args.filter((a) => a !== "--tests");
  const entries = writePluginWebModules(webDir, {
    pluginsDir: path.resolve(webDir, "..", "..", "plugins"),
  });
  const projects = genIfacesProjects(webDir, entries);
  let status = genIfaces(webDir, projects, "src/ifaces.json", flags);
  if (status === 0 && withTests) {
    status = genIfaces(webDir, projects, "test/ifaces.json", flags);
  }
  process.exit(status);
}
