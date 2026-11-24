#!/usr/bin/env node
/**
 * Stages the builtin plugin prefix a server run from this checkout loads from:
 * `packages/server/plugins/`, the `<installation>/plugins` base of an entry under
 * `packages/server/{src,dist}/`, and the prefix every other checkout entry falls back to — the
 * CLI's source behind `pnpm penguin`, the dev-linked CLI (packages/server/src/plugin/
 * workspace-prefix.ts). The desktop build and a release stage theirs with
 * scripts/build-plugins.mjs; a checkout had none, so a preinstalled plugin's server module — the
 * agent browser's, in browser-automation — was missing from every server started here. `pnpm
 * build`, the dev prestep and the web e2e runner run it.
 *
 * Which plugins: preinstalled code plugins (PRFC-0030) and code plugins that also carry Agent
 * content, so a workspace server can enable their bundled modules from the market. Each is copied as npm would
 * publish it — its package.json and the entries its `files` names — from its own build, which has
 * to have run (the plugin's `build`; dev-prebuild.mjs and the e2e runner build first). They bundle
 * what they run, so nothing is installed beside them; a plugin that declares runtime dependencies
 * is staged by scripts/build-plugins.mjs only.
 *
 *   node scripts/stage-dev-plugins.mjs      # writes packages/server/plugins/
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGINS = path.join(ROOT, "plugins");
const PREFIX = path.join(ROOT, "packages", "server", "plugins");
/** The prefix's own manifest, as scripts/build-plugins.mjs writes it. */
const PREFIX_MANIFEST = { name: "penguin-builtin-plugins", private: true, version: "0.0.0" };

const core = await import(
  pathToFileURL(path.join(ROOT, "packages", "core", "dist", "index.js")).href
);

/** The code plugins this checkout stages under plugins/: `{ name, version, dir, files }`. */
function checkoutCodePlugins() {
  const out = [];
  for (const entry of fs.readdirSync(PLUGINS).sort()) {
    const dir = path.join(PLUGINS, entry);
    const manifestFile = path.join(dir, "package.json");
    if (!fs.existsSync(manifestFile)) continue;
    const pkg = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    if (pkg.main === undefined && pkg.exports === undefined) continue;
    if (Object.keys(pkg.dependencies ?? {}).length > 0) continue;
    const table = core.readPluginTable(dir);
    if (table === null) continue;
    const entryFile = core.packageEntry(dir);
    const preinstalled = core.libraryContributions(table, []).card?.preinstall === true;
    if (!preinstalled && (!core.libraryParts(dir).modules || !core.hasLibraryContributions(table)))
      continue;
    if (entryFile === null || !fs.existsSync(entryFile)) {
      throw new Error(`${pkg.name} is not built (no ${entryFile ?? "entry"}): run its build first`);
    }
    out.push({ name: pkg.name, version: pkg.version, dir, files: pkg.files ?? [] });
  }
  return out;
}

const plugins = checkoutCodePlugins();
fs.rmSync(PREFIX, { recursive: true, force: true });
fs.mkdirSync(PREFIX, { recursive: true });
for (const plugin of plugins) {
  const target = path.join(PREFIX, "node_modules", ...plugin.name.split("/"));
  fs.mkdirSync(target, { recursive: true });
  for (const rel of ["package.json", ...plugin.files]) {
    const from = path.join(plugin.dir, rel);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(target, rel), { recursive: true });
  }
}
const dependencies = Object.fromEntries(plugins.map((p) => [p.name, p.version]));
fs.writeFileSync(
  path.join(PREFIX, "package.json"),
  `${JSON.stringify({ ...PREFIX_MANIFEST, dependencies }, null, 2)}\n`,
);
console.log(
  `[stage-dev-plugins] ${plugins.map((p) => p.name).join(", ") || "no plugins"} -> ${path.relative(ROOT, PREFIX)}`,
);
