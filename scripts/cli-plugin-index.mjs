#!/usr/bin/env node
/**
 * The plugin index the CLI's npm package carries: `packages/cli/plugins/index.json`.
 *
 * An npm install of the CLI ships no plugin prefix, so a server installed that way knows of no
 * plugin and fetches none — a registry fetch is only ever of an entry some index lists with its
 * content (`integrity`). This writes the build's own index (scripts/build-plugins.mjs) into the
 * CLI package, keeping the rows of the plugins the release publishes to npm: the server finds it
 * where it finds every build's index, `plugins/index.json` beside the program's `dist/`, and
 * downloads a listed plugin from the registry into `<root>/plugins` when a Project asks for it,
 * checked against the integrity the build computed. A private plugin is never on npm, so its row
 * would name a package nobody can fetch; it is left out.
 *
 *   node scripts/cli-plugin-index.mjs <built prefix's index.json> [<out>]
 *
 * `<out>` defaults to packages/cli/plugins/index.json.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const [from, to = path.join(root, "packages", "cli", "plugins", "index.json")] =
  process.argv.slice(2);
if (from === undefined) {
  console.error("usage: node scripts/cli-plugin-index.mjs <index.json> [<out>]");
  process.exit(2);
}

/** Every `plugins/*` package the release publishes, by npm name. */
const published = new Set();
for (const dir of readdirSync(path.join(root, "plugins"))) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(path.join(root, "plugins", dir, "package.json"), "utf8"));
  } catch {
    continue; // not a package directory
  }
  if (pkg.name && pkg.private !== true) published.add(pkg.name);
}

const rows = JSON.parse(readFileSync(from, "utf8"));
if (!Array.isArray(rows)) throw new Error(`${from}: not an array`);
const kept = rows.filter((row) => published.has(row?.name));
for (const row of kept) {
  if (typeof row.integrity !== "string") throw new Error(`${row.name}: no integrity in ${from}`);
}

mkdirSync(path.dirname(to), { recursive: true });
writeFileSync(to, `${JSON.stringify(kept, null, 2)}\n`);
console.log(
  `[cli-plugin-index] ${kept.length} of ${rows.length} rows → ${path.relative(root, to)}: ${kept.map((r) => r.name).join(", ")}`,
);
