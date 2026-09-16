#!/usr/bin/env node
/**
 * A published package may not depend on one that is never published.
 *
 * `pnpm publish` rewrites every `workspace:*` dependency to that dependency's current version, so
 * a `dependencies` entry naming a `"private": true` workspace package ships as a dependency on a
 * version npm has never seen: `npm install` of the published package then fails with E404. A
 * bundled dependency (tsup `noExternal`) is not needed at runtime at all and belongs in
 * `devDependencies` — bundling is a build-time input, and `devDependencies` are not rewritten
 * into the published manifest.
 *
 * This is the shape that broke the 0.2.12 release: `packages/server` took `@prismshadow/penguin-hmr`
 * — private, and bundled — as a runtime dependency.
 *
 * With `--registry`, it additionally asks npm which of the packages a release publishes do not
 * exist there yet. That is not a defect — a new plugin has to be new once — but it is the one
 * thing the release cannot do on its own: npm's trusted publishing is configured per package, a
 * name that does not exist has no configuration, and the OIDC token exchange 404s. The release
 * job carries no fallback credential, so the first publish of a new name needs a human. Finding
 * that out from a warning on a pull request costs nothing; finding it out from the release run
 * costs a version number, which is what 0.2.13 cost.
 *
 * `--strict` turns that warning into a failure. CI warns, because adding a package is
 * legitimate and blocking every such pull request would be the wrong trade; the release
 * pre-flight fails, because the release genuinely cannot publish a name npm has never seen
 * and finding out mid-loop costs a version number.
 *
 * Usage: node scripts/check-publishable.mjs [--registry] [--strict]
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => JSON.parse(readFileSync(file, "utf8"));

/** Every workspace package under `packages/`, by npm name. */
const workspace = new Map();
for (const dir of readdirSync(path.join(root, "packages"))) {
  const manifest = path.join(root, "packages", dir, "package.json");
  try {
    const pkg = read(manifest);
    if (pkg.name) workspace.set(pkg.name, { dir, private: pkg.private === true });
  } catch {
    // Not a package directory.
  }
}

const problems = [];
for (const [name, { dir, private: isPrivate }] of workspace) {
  if (isPrivate) continue;
  const pkg = read(path.join(root, "packages", dir, "package.json"));
  for (const [dep, range] of Object.entries(pkg.dependencies ?? {})) {
    const target = workspace.get(dep);
    if (target?.private) {
      problems.push(
        `${name} (published) depends on ${dep} (private) as "${range}" — move it to devDependencies, ` +
          `or publish ${dep}. As written, the published manifest names a version npm does not have.`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error(`publishable packages: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
const publishable = [...workspace.values()].filter((p) => !p.private).length;
console.log(
  `publishable packages: ${publishable} publishable, none depends on a private workspace package`,
);

if (!process.argv.includes("--registry")) process.exit(0);

// Everything the release publishes: the non-private packages above, plus every plugin — the
// release loops `plugins/*/` and publishes each as `@penguinharness/<dir>`.
// Read each plugin's own name and private flag rather than deriving a name from its directory:
// `plugins/sandbox-*` are `@prismshadow/penguin-plugin-sandbox-*` and private, so a name built
// from the directory names a package that does not exist and never will.
const pluginNames = [];
for (const entry of readdirSync(path.join(root, "plugins"), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  try {
    const pkg = read(path.join(root, "plugins", entry.name, "package.json"));
    if (pkg.name && pkg.private !== true) pluginNames.push(pkg.name);
  } catch {
    // Not a package directory.
  }
}

const names = [
  ...[...workspace.entries()].filter(([, p]) => !p.private).map(([name]) => name),
  ...pluginNames,
].sort();

const missing = [];
for (const name of names) {
  try {
    execFileSync("npm", ["view", name, "name"], { stdio: ["ignore", "ignore", "ignore"] });
  } catch {
    missing.push(name);
  }
}

if (missing.length > 0) {
  const list = missing.join(", ");
  const strict = process.argv.includes("--strict");
  const say = strict ? console.error : console.log;
  say(
    `${strict ? "" : "::warning::"}${missing.length} package(s) have never been published: ${list}. ` +
      `npm trusted publishing is configured per package, so the release's OIDC exchange cannot ` +
      `create a name that does not exist yet and will fail on the first one it reaches. ` +
      `Publish each once by hand (or give it a trusted publisher) BEFORE tagging.`,
  );
  say(`first publish needed: ${list}`);
  if (strict) {
    console.error(
      "Publish each once by hand with credentials that may create it, then re-run. The release " +
        "cannot do this itself.",
    );
    process.exit(1);
  }
} else {
  console.log(`registry: all ${names.length} published names already exist`);
}
