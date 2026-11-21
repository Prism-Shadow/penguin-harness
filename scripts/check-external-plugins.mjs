#!/usr/bin/env node
/**
 * The external built-in plugins (scripts/lib/external-plugins.mjs) are pinned the way a build
 * ships them: packages/server, packages/cli and packages/desktop each name the same exact
 * version of every one, and pnpm-lock.yaml resolves that version with a sha512. Three hosts
 * pinning two versions would ship one plugin in the server's built-in prefix and another in the
 * CLI's or the desktop app's library.
 *
 * With `--index`, it also compares the lock's sha512 of each pin with the one the plugin index
 * registers for that version (scripts/lib/plugin-index.mjs; `PENGUIN_PLUGIN_INDEX_URL` names
 * another index): a pin the index does not vouch for fails. An index that cannot be read — an
 * offline build — skips that comparison with a warning.
 *
 * Usage: node scripts/check-external-plugins.mjs [--index]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HOST_PACKAGES, externalPins, pinProblems } from "./lib/external-plugins.mjs";
import { readPnpmLock } from "./lib/locked-prefix.mjs";
import { checkPinsAgainstIndex, pluginIndexUrl } from "./lib/plugin-index.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = readPnpmLock(root);

const problems = pinProblems(root, lock);
if (problems.length > 0) {
  console.error(`external built-in plugins:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  process.exit(1);
}
const pins = externalPins(root, lock);
if (pins.length === 0) {
  console.log("external built-in plugins: none pinned");
  process.exit(0);
}
const named = pins.map((p) => `${p.name}@${p.version}`).join(", ");
console.log(`external built-in plugins: ${named}, pinned alike in ${HOST_PACKAGES.join(", ")}`);

if (process.argv.includes("--index")) {
  const url = pluginIndexUrl();
  const verdict = await checkPinsAgainstIndex(pins, url);
  if ("skipped" in verdict) {
    const warning = `the plugin index could not be read (${verdict.skipped}), so the lock's integrity was not compared with it`;
    console.log(process.env.GITHUB_ACTIONS ? `::warning::${warning}` : `warning: ${warning}`);
  } else if (verdict.problems.length > 0) {
    console.error(
      `external built-in plugins against ${url}:\n${verdict.problems.map((p) => `  - ${p}`).join("\n")}`,
    );
    process.exit(1);
  } else {
    console.log(`external built-in plugins: the lock's integrity is the one ${url} registers`);
  }
}
