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
 * package.json it keeps `tsconfig.web.json` (DOM and JSX, its `src/web/` only). The plugin's web
 * modules land in the app's own table, so the boot check judges them with the app's: a workspace
 * plugin's are read with the app's program, which the generated list leads to them, from the
 * plugin's own directory; a plugin installed under node_modules, which that program never reads, is
 * read through its `tsconfig.web.json`, handed to the interface generator as one more `--project`.
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
    // A library package's web half (library/<domain>, its `./web` entry) is not a shipped
    // plugin's: the host compiles it with its own program and boots its module classes from
    // web-root's children, so it never joins the generated plugin list.
    if (name.startsWith("@prismshadow/penguin-library-")) continue;
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
    const dir = workspaceDirOf(name, pluginsDir) ?? path.dirname(installed);
    const tsconfig = path.join(dir, "tsconfig.web.json");
    if (!fs.existsSync(tsconfig)) {
      throw new Error(`${name}: has a web half but no tsconfig.web.json beside its package.json`);
    }
    entries.push({ name, specifier: `${name}/web`, tsconfig });
  }
  return entries;
}

/**
 * The entries the interface generator must read through a project of their own: a plugin installed
 * under node_modules, which the generator never reads from the app's program. A workspace plugin
 * (linked from plugins/) is already in the app's program: the generated list imports it, and its
 * files are outside node_modules, so they are read with the app's. Handing its tsconfig over as
 * well would read every file twice, and the second read fails the generator.
 */
export function separateProjects(entries) {
  return entries.filter((e) => e.tsconfig.split(path.sep).includes("node_modules"));
}

/** The generated list's source for `entries`. */
export function pluginWebModuleSource(entries) {
  const lines = [
    "/**",
    " * Generated by scripts/gen-web-table.mjs: the web halves of the shipped plugins this package",
    ' * depends on (each package\'s `exports["./web"]`), in the order its package.json lists them.',
    " * Do not edit; `pnpm gen:ifaces` writes it.",
    " */",
    'import type { ModuleClass } from "@prismshadow/penguin-core/kernel";',
  ];
  entries.forEach((entry, i) => lines.push(`import plugin${i} from "${entry.specifier}";`));
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
  entries.forEach((entry, i) =>
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

/** Runs the interface generator over `projects` into `out`; answers its exit status. */
function genIfaces(webDir, projects, out, flags) {
  const result = spawnSync(
    process.execPath,
    [
      path.resolve(webDir, "..", "..", "scripts", "gen-ifaces.mjs"),
      ...projects.flatMap((p) => ["--project", p]),
      "--out",
      out,
      ...flags,
    ],
    { cwd: webDir, stdio: "inherit" },
  );
  return result.status ?? 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const webDir = path.resolve(here, "..");
  const args = process.argv.slice(2);
  const withTests = args.includes("--tests");
  const flags = args.filter((a) => a !== "--tests");
  const entries = writePluginWebModules(webDir, {
    pluginsDir: path.resolve(webDir, "..", "..", "plugins"),
  });
  const plugins = separateProjects(entries).map((e) => path.relative(webDir, e.tsconfig));
  let status = genIfaces(webDir, ["tsconfig.app.json", ...plugins], "src/ifaces.json", flags);
  if (status === 0 && withTests) {
    status = genIfaces(webDir, ["tsconfig.json", ...plugins], "test/ifaces.json", flags);
  }
  process.exit(status);
}
