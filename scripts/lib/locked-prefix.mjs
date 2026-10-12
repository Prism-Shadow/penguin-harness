/**
 * The builtin prefix's third-party packages, held to what pnpm-lock.yaml resolves.
 *
 * scripts/build-plugins.mjs installs the builtin plugins with npm, and npm resolves every `^`
 * range in a native dependency's tree against the registry at build time — so the prefix ran a
 * DSH chain (cordis, cosmokit, schemastery, ...) newer than the one the workspace was tested
 * with, and two builds a day apart could ship different code under the same lockfile. This
 * module reads the closure of the plugins' NATIVE_DEPENDENCIES from the lockfile, hands it to npm
 * as `overrides` in the prefix's own manifest (an override pins every instance of a package,
 * transitive ones included), and afterwards compares npm's tree with the lockfile by version and
 * by tarball integrity, so a drift, a republished tarball or a package the lockfile never named
 * fails the build instead of shipping.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/** The parsed pnpm-lock.yaml under `root` (`yaml` comes from core, the root declares none). */
export function readPnpmLock(root) {
  const yaml = createRequire(path.join(root, "packages", "core", "package.json"))("yaml");
  return yaml.parse(fs.readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8"));
}

/** Whether an `os`/`cpu` list (`["linux"]`, `["!win32"]`) admits `value`; no list admits all. */
function admits(list, value) {
  if (!list) return true;
  if (list.includes(`!${value}`)) return false;
  return list.includes(value) || list.every((v) => v.startsWith("!"));
}

/**
 * `name` → `version` of every package the `natives` declared by the lockfile importers
 * `importers` (`plugins/<dir>`) need, as pnpm-lock.yaml resolves them: their snapshots'
 * dependencies and optional dependencies, transitively, minus the platform packages for none of
 * the `targets` (`[{ os, cpu }]`). Throws when one name resolves to two versions — an override
 * holds one.
 */
export function lockedClosure(lock, importers, natives, targets) {
  const queue = [];
  for (const key of importers) {
    for (const [name, { version }] of Object.entries(lock.importers?.[key]?.dependencies ?? {})) {
      if (natives.has(name)) queue.push([name, version]);
    }
  }
  const closure = new Map();
  for (const [name, ref] of queue) {
    const version = ref.replace(/\(.*$/, ""); // `0.1.0-rc.7(<peers>)` → `0.1.0-rc.7`
    const pkg = lock.packages?.[`${name}@${version}`];
    if (pkg === undefined) throw new Error(`pnpm-lock.yaml has no package ${name}@${version}`);
    if (!targets.some((t) => admits(pkg.os, t.os) && admits(pkg.cpu, t.cpu))) continue;
    if (closure.has(name)) {
      if (closure.get(name) !== version) {
        throw new Error(`${name}: pnpm-lock.yaml resolves ${closure.get(name)} and ${version}`);
      }
      continue;
    }
    closure.set(name, version);
    const snapshot = lock.snapshots?.[`${name}@${ref}`] ?? {};
    for (const next of [snapshot.dependencies, snapshot.optionalDependencies]) {
      queue.push(...Object.entries(next ?? {}));
    }
  }
  return new Map([...closure].sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** The `resolution.integrity` pnpm-lock.yaml pins for `name@version`, if any. */
function lockedIntegrity(lock, name, version) {
  return lock.packages?.[`${name}@${version}`]?.resolution?.integrity;
}

/** The lockfile entries the closure was read from, for build-plugins' cache key. */
export function lockCacheInput(lock, closure) {
  return [...closure]
    .map(([name, version]) => `${name}@${version} ${lockedIntegrity(lock, name, version)}`)
    .join("\0");
}

/**
 * The closure's per-platform packages (those with an `os` or `cpu`), as `name@version`: npm
 * installs only the building machine's, so build-plugins installs the rest with `--force`.
 */
export function platformSpecs(lock, closure) {
  return [...closure]
    .filter(([name, version]) => {
      const pkg = lock.packages[`${name}@${version}`];
      return pkg.os !== undefined || pkg.cpu !== undefined;
    })
    .map(([name, version]) => `${name}@${version}`);
}

/**
 * Every way npm's installed tree departs from pnpm-lock.yaml, as messages (empty when none).
 * `npmLock` is npm's hidden lockfile (`node_modules/.package-lock.json`): each installed package
 * keyed by its path, with the integrity of the tarball npm verified on download. Packages named
 * in `ignored` (the builtin plugins, installed from their own tarballs) are not checked.
 */
export function integrityMismatches(lock, closure, npmLock, ignored = new Set()) {
  const problems = [];
  const seen = new Set();
  for (const [key, entry] of Object.entries(npmLock.packages ?? {})) {
    if (key === "") continue; // the prefix's own manifest
    const name = entry.name ?? key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);
    if (ignored.has(name)) continue;
    const id = `${name}@${entry.version}`;
    seen.add(name);
    if (closure.get(name) !== entry.version) {
      problems.push(`${id}: not in the locked closure`);
      continue;
    }
    const want = lockedIntegrity(lock, name, entry.version);
    if (want === undefined) problems.push(`${id}: pnpm-lock.yaml records no integrity`);
    else if (entry.integrity !== want) {
      problems.push(`${id}: npm installed ${entry.integrity ?? "(no integrity)"}, locked ${want}`);
    }
  }
  for (const [name, version] of closure) {
    if (!seen.has(name)) problems.push(`${name}@${version}: not in npm's lockfile`);
  }
  return problems;
}
