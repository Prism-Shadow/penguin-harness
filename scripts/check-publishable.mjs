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
 * Usage: node scripts/check-publishable.mjs
 */
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
console.log(
  `publishable packages: ${[...workspace.values()].filter((p) => !p.private).length} publishable, none depends on a private workspace package`,
);
