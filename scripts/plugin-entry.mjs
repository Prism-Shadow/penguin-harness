/**
 * One plugin entry — one package at one version with one content — as the build, a machine's
 * plugin store and the index repository (Prism-Shadow/penguin-plugins) all lay it out:
 *
 *   packages/[<@scope>/]<bucket>/<name>/<version>/<first 16 hex digits of its integrity>/
 *     manifest.toml      the index manifest, `integrity` required
 *     package/           the package, every dependency it needs inside its own node_modules
 *
 * The bucket keeps every directory narrow however many plugins there are. It is read off the
 * name without its scope, lower-cased, the way the crates.io index files a crate: a name of 1
 * or 2 characters sits in `1` or `2`, one of 3 in `3/<first character>`, a longer one in
 * `<characters 1–2>/<characters 3–4>` — `@penguinharness/sandbox-bwrap` is under
 * `packages/@penguinharness/sa/nd/sandbox-bwrap/`. The index repository has a line-for-line
 * copy of this rule (`plugin-index/src/entry.ts`); both test the same path vectors.
 *
 * The index repository's entries also carry a `package-lock.json`; nothing on a machine reads
 * one, so neither the build nor the store writes it.
 *
 * Plain JavaScript because scripts/build-plugins.mjs runs it directly and the server bundles
 * it (packages/server/src/plugin/store.ts); the types are in plugin-entry.d.mts. One copy, so
 * the tree the build lays out and the tree a machine's store writes cannot drift.
 *
 * THE KEY IS THE CONTENT, AND THE CONTENT IS NPM'S. `integrity` is npm's own `dist.integrity`:
 * `sha512-<base64>` of the bytes of the tarball the registry serves — the value in the registry's
 * metadata and in every npm lockfile, which anyone can check with `npm view <name>@<version>
 * dist.integrity`. It covers the package, not its dependencies. Nothing here hashes a directory:
 * the build computes it over the very tarball it publishes (`tarballIntegrity`), a fetch takes
 * the value npm recorded for what it downloaded, and the index repository takes the registry's.
 * An entry's directory is the first 16 hex digits of the sha512.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export const MANIFEST_FILE = "manifest.toml";
export const PACKAGE_DIR = "package";
/** The flat listing rebuilt from a tree, beside it. */
export const INDEX_FILE = "index.json";

/** `sha512-<base64 of 64 bytes>`: an entry's integrity, npm's `dist.integrity`. */
export const INTEGRITY = /^sha512-([A-Za-z0-9+/]{86}==)$/;
/** How many hex digits of the integrity name an entry's directory. */
export const KEY_LENGTH = 16;

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The directory key of an integrity: the first 16 hex digits of its sha512, or null when malformed. */
export function entryKey(integrity) {
  const b64 = INTEGRITY.exec(integrity)?.[1];
  return b64 === undefined ? null : Buffer.from(b64, "base64").toString("hex").slice(0, KEY_LENGTH);
}

/** npm's integrity of a tarball file: `sha512-<base64>` of its bytes (what `dist.integrity` is). */
export async function tarballIntegrity(file) {
  const hash = createHash("sha512");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return `sha512-${hash.digest("base64")}`;
}

/** The directory under a tree root that holds every entry: `<root>/packages`. */
export const PACKAGES_DIR = "packages";

/** The bucket directories of a package name, as path segments (see the header). */
export function bucketOf(name) {
  const bare = (name.startsWith("@") ? name.slice(name.indexOf("/") + 1) : name).toLowerCase();
  if (bare.length <= 2) return [String(bare.length)];
  if (bare.length === 3) return ["3", bare[0]];
  return [bare.slice(0, 2), bare.slice(2, 4)];
}

/** Where a package name's entries sit under a tree root, as posix segments: `packages/…/<name>`. */
export function nameSegments(name) {
  const parts = name.split("/");
  const bare = parts[parts.length - 1];
  const scope = parts.length === 2 ? [parts[0]] : [];
  return [PACKAGES_DIR, ...scope, ...bucketOf(name), bare];
}

/** An entry's directory under a tree root: `<root>/packages/…/<name>/<version>/<key>`. */
export function entryDir(root, name, version, integrity) {
  const key = entryKey(integrity);
  if (key === null) throw new Error(`'${integrity}' is not a sha512 integrity`);
  return path.join(root, ...nameSegments(name), version, key);
}

/** The subdirectories of `dir` whose names do not start with a dot; empty when it cannot be read. */
async function subdirs(dir) {
  try {
    return (await fsp.readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort(byCodeUnit);
  } catch {
    return [];
  }
}

/**
 * Every package name a tree root files entries under, with its directory, sorted. A directory
 * whose place does not spell its name's bucket is not a name (the path is the entry): it is
 * left out, as is anything outside `packages/`.
 */
export async function treeNames(root) {
  const packages = path.join(root, PACKAGES_DIR);
  const out = [];
  const containers = [{ scope: null, dir: packages }];
  for (const top of await subdirs(packages)) {
    if (top.startsWith("@")) containers.push({ scope: top, dir: path.join(packages, top) });
  }
  for (const { scope, dir } of containers) {
    for (const b1 of await subdirs(dir)) {
      if (b1.startsWith("@")) continue;
      // `1` and `2` hold names directly; `3` and a two-character bucket have a second level.
      const levels =
        b1 === "1" || b1 === "2"
          ? [[b1]]
          : (await subdirs(path.join(dir, b1))).map((b2) => [b1, b2]);
      for (const bucket of levels) {
        for (const bare of await subdirs(path.join(dir, ...bucket))) {
          const name = scope === null ? bare : `${scope}/${bare}`;
          if (bucketOf(name).join("/") !== bucket.join("/")) continue;
          out.push({ name, dir: path.join(dir, ...bucket, bare) });
        }
      }
    }
  }
  return out.sort((a, b) => byCodeUnit(a.name, b.name));
}

/** Regular files under `dir`, as sorted relative posix paths; symlinks are not files. */
export async function walkFiles(dir, prefix = "") {
  const out = [];
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    const rel = prefix === "" ? e.name : `${prefix}/${e.name}`;
    if (e.isDirectory()) out.push(...(await walkFiles(path.join(dir, e.name), rel)));
    else if (e.isFile()) out.push(rel);
  }
  return out.sort(byCodeUnit);
}

/** Whether anything may execute `abs`: any of its execute bits. */
export function isExecutable(abs) {
  try {
    return (fs.statSync(abs).mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Laying out an entry
// ---------------------------------------------------------------------------

/** Copies `from`'s files to `to`, each 0755 when anything may execute it and 0644 otherwise. */
async function copyNormalized(from, to) {
  for (const rel of await walkFiles(from)) {
    const src = path.join(from, ...rel.split("/"));
    const dest = path.join(to, ...rel.split("/"));
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(src, dest);
    await fsp.chmod(dest, isExecutable(src) ? 0o755 : 0o644);
  }
}

/** The package.json under `dir`, or null. */
export async function readPackageJson(dir) {
  try {
    return JSON.parse(await fsp.readFile(path.join(dir, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

const names = (table) => (table !== null && typeof table === "object" ? Object.keys(table) : []);

/**
 * The dependencies of the package at `pkgDir` that live OUTSIDE it, in the prefix `prefixDir`
 * it was installed into: what npm hoisted to `<prefix>/node_modules/<dep>`, found the way Node
 * finds a package (`node_modules` upward, stopping at the prefix), for its dependencies and
 * optional dependencies, transitively. A dependency nested inside the package already travels
 * with it; an optional one npm did not install (another platform's binary) is skipped.
 */
async function hoistedDependencies(pkgDir, prefixDir) {
  const out = new Map();
  const top = path.resolve(prefixDir);
  const inside = (dir) => dir === pkgDir || dir.startsWith(pkgDir + path.sep);
  const visit = async (from) => {
    const manifest = await readPackageJson(from);
    if (manifest === null) return;
    for (const dep of [...names(manifest.dependencies), ...names(manifest.optionalDependencies)]) {
      let found = null;
      for (let dir = from; ; dir = path.dirname(dir)) {
        const candidate = path.join(dir, "node_modules", ...dep.split("/"));
        if (fs.existsSync(path.join(candidate, "package.json"))) {
          found = candidate;
          break;
        }
        if (dir === top || path.dirname(dir) === dir) break;
      }
      if (found === null || inside(found) || out.has(dep)) continue;
      out.set(dep, found);
      await visit(found);
    }
  };
  await visit(pkgDir);
  return out;
}

/** An author as the index repository writes one: a display name, optionally `<contact>`. */
function authorOf(value) {
  if (typeof value === "string") return value.trim() === "" ? null : value.trim();
  if (value === null || typeof value !== "object") return null;
  if (typeof value.name !== "string" || value.name.trim() === "") return null;
  const contact =
    typeof value.email === "string"
      ? value.email
      : typeof value.url === "string"
        ? value.url
        : null;
  return contact === null ? value.name.trim() : `${value.name.trim()} <${contact}>`;
}

const strings = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === "string") : []);

/**
 * The index manifest of a package, from its own package.json, with `integrity`. `categories`
 * is the package's own top-level field (the shape VS Code's extension manifests use): npm
 * has no such field, and the index needs one to group the catalogue. `os` — the platforms the
 * plugin runs on, `process.platform` words — is the package's `penguinOs`: a private field,
 * because npm's own `os` would make npm refuse the package on every other platform, and the
 * builtin prefix installs every backend on every platform it is built on.
 */
export function manifestOf(pkg, name, version, integrity) {
  const authors = [pkg.author, ...(Array.isArray(pkg.contributors) ? pkg.contributors : [])]
    .map(authorOf)
    .filter((a) => a !== null);
  const repository =
    typeof pkg.repository === "string"
      ? pkg.repository
      : pkg.repository !== null &&
          typeof pkg.repository === "object" &&
          typeof pkg.repository.url === "string"
        ? pkg.repository.url.replace(/^git\+/, "")
        : undefined;
  const keywords = strings(pkg.keywords);
  const categories = strings(pkg.categories);
  const os = strings(pkg.penguinOs);
  return {
    name,
    version,
    description: typeof pkg.description === "string" ? pkg.description : "",
    authors,
    license: typeof pkg.license === "string" ? pkg.license : "",
    ...(repository !== undefined ? { repository } : {}),
    ...(typeof pkg.homepage === "string" ? { homepage: pkg.homepage } : {}),
    ...(keywords.length > 0 ? { keywords } : {}),
    ...(categories.length > 0 ? { categories } : {}),
    ...(os.length > 0 ? { os } : {}),
    integrity,
  };
}

/**
 * Lays out the package at `pkgDir` — installed into the npm prefix `prefixDir` — as an entry
 * in the directory `stage`: `package/` (the package, its hoisted dependencies copied into its
 * own `node_modules`, modes normalized), then `manifest.toml`, written by `stringifyToml`.
 * `integrity` is the package's npm integrity, which the caller knows (the tarball it packed,
 * the index row, what npm recorded); nothing here computes one. Answers the entry's name,
 * version, integrity and manifest.
 */
export async function layOutEntry(stage, pkgDir, prefixDir, { stringifyToml, integrity }) {
  if (entryKey(integrity) === null) throw new Error(`'${integrity}' is not a sha512 integrity`);
  const pkg = await readPackageJson(pkgDir);
  const name = typeof pkg?.name === "string" ? pkg.name : null;
  const version = typeof pkg?.version === "string" ? pkg.version : null;
  if (pkg === null || name === null || version === null) {
    throw new Error(`${pkgDir}: no package.json with a package name and a version`);
  }
  await copyNormalized(pkgDir, path.join(stage, PACKAGE_DIR));
  for (const [dep, dir] of await hoistedDependencies(path.resolve(pkgDir), prefixDir)) {
    await copyNormalized(dir, path.join(stage, PACKAGE_DIR, "node_modules", ...dep.split("/")));
  }
  const manifest = manifestOf(pkg, name, version, integrity);
  await fsp.writeFile(path.join(stage, MANIFEST_FILE), stringifyToml(manifest));
  return { name, version, integrity, manifest };
}

/** Index entries in the order a tree's index is written: name, then version, then integrity. */
export function sortIndex(entries) {
  return [...entries].sort(
    (a, b) =>
      byCodeUnit(a.name, b.name) ||
      byCodeUnit(a.version, b.version) ||
      byCodeUnit(a.integrity, b.integrity),
  );
}
