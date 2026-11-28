#!/usr/bin/env node
/**
 * Release preparation: refresh the plugin market's built-in copy from the community repository.
 *
 *   node scripts/sync-market-assets.mjs <penguin-harness-community checkout>
 *
 * Copies the market document, `assets/plugins/market.json`, over
 * library/plugin/src/builtin-market.json. Then, for every built-in plugin (a package under
 * plugins/, by the name its package.json gives) whose cover the document names, copies that cover
 * and its thumbnail into library/plugin/src/market-covers/ at the path the document names
 * them by (scripts/market-covers.mjs), after emptying the folder, so a cover the document no
 * longer names does not linger. Screenshots stay in the community repository: the server fetches
 * and keeps those. Prints each file and the total bytes the build now carries.
 *
 * Afterwards: `pnpm exec prettier --write library/plugin/src/builtin-market.json`, then
 * the server's plugin-market suite, which fails on a copy the server would refuse.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MARKET_COVERS_SOURCE, marketCoverFiles } from "./market-covers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const community = process.argv[2];
if (community === undefined) {
  console.error("usage: node scripts/sync-market-assets.mjs <penguin-harness-community checkout>");
  process.exit(2);
}
const assets = path.resolve(community, "assets", "plugins");
const documentFile = path.join(assets, "market.json");
if (!fs.existsSync(documentFile)) {
  console.error(`sync-market-assets: no market document at ${documentFile}`);
  process.exit(2);
}
const doc = JSON.parse(fs.readFileSync(documentFile, "utf8"));

/** The package names of the plugins this build ships. */
const builtIn = new Set();
for (const entry of fs.readdirSync(path.join(ROOT, "plugins"), { withFileTypes: true })) {
  const manifest = path.join(ROOT, "plugins", entry.name, "package.json");
  if (entry.isDirectory() && fs.existsSync(manifest)) {
    builtIn.add(JSON.parse(fs.readFileSync(manifest, "utf8")).name);
  }
}

const covers = path.join(ROOT, MARKET_COVERS_SOURCE);
fs.rmSync(covers, { recursive: true, force: true });
const missing = [];
for (const [name, entry] of Object.entries(doc.plugins ?? {})) {
  if (!builtIn.has(name) || entry.cover === undefined) continue;
  for (const rel of [entry.cover.src, entry.cover.thumb].filter((p) => typeof p === "string")) {
    const from = path.join(assets, ...rel.split("/"));
    if (!fs.existsSync(from)) {
      missing.push(rel);
      continue;
    }
    const to = path.join(covers, ...rel.split("/"));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}
fs.copyFileSync(documentFile, path.join(ROOT, "library", "plugin", "src", "builtin-market.json"));

let bytes = 0;
const files = marketCoverFiles(ROOT);
for (const rel of files) bytes += fs.statSync(path.join(covers, ...rel.split("/"))).size;
const uncovered = [...builtIn].filter((name) => doc.plugins?.[name]?.cover === undefined).sort();
console.log(`sync-market-assets: market.json -> library/plugin/src/builtin-market.json`);
console.log(
  `sync-market-assets: ${files.length} cover files, ${bytes} bytes -> ${MARKET_COVERS_SOURCE}`,
);
if (uncovered.length > 0)
  console.log(`  built-in plugins with no cover in the document: ${uncovered.join(", ")}`);
if (missing.length > 0) {
  console.error(
    `sync-market-assets: the document names files the checkout lacks: ${missing.join(", ")}`,
  );
  process.exit(1);
}
