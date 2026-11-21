/**
 * The plugins of this repository that carry their own version. Every other `plugins/*` package
 * moves with the harness: release prep raises its package.json to the release's version, and the
 * npm job (scripts/release-npm.sh stamp) stamps the tag's version into it and into the server's
 * embedded index before publishing it with the rest of the chain. A package listed here keeps
 * the version its package.json was committed with:
 *
 *   - nothing in the release path rewrites it, and the server's embedded index
 *     (packages/server/src/plugin/builtin-index.json) lists it at that version;
 *   - it is raised by hand whenever anything the package is built or packed from changes, which
 *     scripts/check-plugin-versions.mjs enforces on every pull request;
 *   - the release packs it once (scripts/pack-own-plugins.mjs), attaches that tarball to the
 *     tag's GitHub Release, and publishes the same file to npm with provenance once trusted
 *     publishing is set up for it (release.yml), skipping a version npm already has.
 *
 * Each name maps to the reason it is versioned apart. Run as a script, it prints the names, one
 * per line, for the shell steps that skip them.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const OWN_VERSION = new Map([
  [
    "@penguinharness/computer-use",
    "market-only (scripts/build-plugins.mjs): an administrator installs it from the plugin market, so its version counts its own changes, not the harness releases that carried it",
  ],
]);

/**
 * The packages under `<root>/plugins/` that OWN_VERSION names: `[{ name, version, dir, manifest }]`,
 * sorted by directory. Throws when a listed name has no package there, so a rename cannot drop a
 * plugin back into the harness's version without anyone noticing.
 */
export function ownVersionPackages(root) {
  const pluginsDir = path.join(root, "plugins");
  const found = new Map();
  for (const dirName of fs.readdirSync(pluginsDir).sort()) {
    const file = path.join(pluginsDir, dirName, "package.json");
    if (!fs.existsSync(file)) continue;
    const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!OWN_VERSION.has(manifest.name)) continue;
    const dir = path.join(pluginsDir, dirName);
    found.set(manifest.name, { name: manifest.name, version: manifest.version, dir, manifest });
  }
  const missing = [...OWN_VERSION.keys()].filter((name) => !found.has(name));
  if (missing.length > 0) {
    throw new Error(`no package under plugins/ is named ${missing.join(", ")}`);
  }
  return [...found.values()];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log([...OWN_VERSION.keys()].join("\n"));
}
