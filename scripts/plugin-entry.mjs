/**
 * One plugin entry — one package at one version with one content — as the build, a machine's
 * plugin store and the index repository (Prism-Shadow/penguin-plugins) all lay it out:
 *
 *   <npm name>/<version>/<first 16 hex digits of its integrity>/
 *     manifest.toml      the index manifest, `integrity` required
 *     package/           the package, every dependency it needs inside its own node_modules
 *
 * The index repository's entries also carry a `package-lock.json`; nothing on a machine reads
 * one, so neither the build nor the store writes it.
 *
 * Plain JavaScript because scripts/build-plugins.mjs runs it directly and the server bundles
 * it (packages/server/src/plugin/store.ts); the types are in plugin-entry.d.mts. One copy, so
 * the tree the build lays out and the tree a machine's store writes cannot drift.
 *
 * THE KEY IS THE CONTENT. `integrity` is `sha256-<hex>` of `package/` archived by the
 * deterministic ustar archiver below — the same algorithm, line for line, as the index
 * repository's (`packages/plugin-index/src/archive.ts`), so an index entry's integrity is what
 * a machine computes over the package it fetched. The format, fully specified here:
 *
 *   - one entry per regular file; no directory entries, and symlinks are not files (npm's
 *     `.bin` shims are left out);
 *   - entries sorted by their path, comparing UTF-16 code units;
 *   - every mtime is 0, uid and gid are 0, user and group names are empty;
 *   - the mode is 0755 when any execute bit is set on the source file and 0644 otherwise;
 *   - a path that does not fit the ustar name and prefix fields, or is not ASCII, is carried
 *     in a pax extended header (`path=`) just before its entry;
 *   - the stream ends with two zero blocks.
 *
 * The hash is of this stream before any compression: the bytes gzip produces depend on the
 * zlib that ran it.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export const MANIFEST_FILE = "manifest.toml";
export const PACKAGE_DIR = "package";
/** The flat listing rebuilt from a tree, beside it. */
export const INDEX_FILE = "index.json";

/** `sha256-<64 lowercase hex digits>`: an entry's integrity. */
export const INTEGRITY = /^sha256-([0-9a-f]{64})$/;
/** How many hex digits of the integrity name an entry's directory. */
export const KEY_LENGTH = 16;

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The directory key of an integrity: its first 16 hex digits, or null when malformed. */
export function entryKey(integrity) {
  return INTEGRITY.exec(integrity)?.[1]?.slice(0, KEY_LENGTH) ?? null;
}

/** An entry's directory under a tree root: `<root>/<name>/<version>/<key>`. */
export function entryDir(root, name, version, integrity) {
  const key = entryKey(integrity);
  if (key === null) throw new Error(`'${integrity}' is not a sha256 integrity`);
  return path.join(root, ...name.split("/"), version, key);
}

// ---------------------------------------------------------------------------
// The archiver
// ---------------------------------------------------------------------------

const BLOCK = 512;
const MAX_SIZE = 0o77777777777; // 11 octal digits: 8 GiB - 1

function octal(value, width) {
  return `${value.toString(8).padStart(width - 1, "0")}\0`;
}

function header(name, prefix, size, mode, type) {
  const block = Buffer.alloc(BLOCK);
  block.write(name, 0, 100, "utf8");
  block.write(octal(mode, 8), 100, 8, "ascii");
  block.write(octal(0, 8), 108, 8, "ascii"); // uid
  block.write(octal(0, 8), 116, 8, "ascii"); // gid
  block.write(octal(size, 12), 124, 12, "ascii");
  block.write(octal(0, 12), 136, 12, "ascii"); // mtime
  block.write("        ", 148, 8, "ascii"); // checksum, as spaces while summing
  block.write(type, 156, 1, "ascii");
  block.write("ustar\0", 257, 6, "ascii");
  block.write("00", 263, 2, "ascii");
  block.write(prefix, 345, 155, "utf8");
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return block;
}

function padding(size) {
  const rest = size % BLOCK;
  return Buffer.alloc(rest === 0 ? 0 : BLOCK - rest);
}

/** `rel` as ustar's name and prefix fields, or null when it needs a pax header. */
function ustarPath(rel) {
  if (!/^[\x20-\x7e]*$/.test(rel)) return null;
  if (rel.length <= 100) return { name: rel, prefix: "" };
  for (let i = rel.indexOf("/"); i !== -1; i = rel.indexOf("/", i + 1)) {
    const prefix = rel.slice(0, i);
    const name = rel.slice(i + 1);
    if (prefix.length <= 155 && name.length <= 100 && name !== "") return { name, prefix };
  }
  return null;
}

/** One pax record, `<length> path=<value>\n`, where the length counts itself. */
function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`;
  const bodyBytes = Buffer.byteLength(body, "utf8");
  let length = bodyBytes + 1;
  while (String(length).length + bodyBytes !== length) length += 1;
  return Buffer.from(`${length}${body}`, "utf8");
}

function assertRel(rel) {
  if (
    rel === "" ||
    rel.startsWith("/") ||
    rel.includes("\\") ||
    rel.includes("\0") ||
    rel.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`'${rel}' is not a relative posix path an archive may hold`);
  }
}

/**
 * The archive over `files` (`{ rel, abs, exec }`), as a sequence of chunks — so a caller
 * hashing it never holds more than one file in memory.
 */
export async function* archiveChunks(files) {
  const sorted = [...files].sort((a, b) => byCodeUnit(a.rel, b.rel));
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].rel === sorted[i - 1].rel) {
      throw new Error(`'${sorted[i].rel}' appears twice in one archive`);
    }
  }
  for (const file of sorted) {
    assertRel(file.rel);
    const data = await fsp.readFile(file.abs);
    if (data.byteLength > MAX_SIZE) throw new Error(`${file.rel} is too large for an archive`);
    const mode = file.exec ? 0o755 : 0o644;
    const fits = ustarPath(file.rel);
    if (fits === null) {
      const pax = paxRecord("path", file.rel);
      yield header("PaxHeader", "", pax.byteLength, 0o644, "x");
      yield pax;
      yield padding(pax.byteLength);
      // The ustar name is only a fallback for readers that ignore pax: keep it ASCII.
      const fallback = file.rel.replace(/[^\x20-\x7e]/g, "_").slice(-100);
      yield header(fallback, "", data.byteLength, mode, "0");
    } else {
      yield header(fits.name, fits.prefix, data.byteLength, mode, "0");
    }
    yield data;
    yield padding(data.byteLength);
  }
  yield Buffer.alloc(BLOCK * 2);
}

/** `sha256-<hex>` of the archive over `files`. */
export async function archiveIntegrity(files) {
  const hash = createHash("sha256");
  for await (const chunk of archiveChunks(files)) hash.update(chunk);
  return `sha256-${hash.digest("hex")}`;
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

/** The integrity of the `package/` directory under `entry`. */
export async function packageIntegrity(entry) {
  const dir = path.join(entry, PACKAGE_DIR);
  const rels = await walkFiles(dir);
  if (rels.length === 0) throw new Error(`${entry}: the package has no files`);
  return archiveIntegrity(
    rels.map((rel) => {
      const abs = path.join(dir, ...rel.split("/"));
      return { rel: `${PACKAGE_DIR}/${rel}`, abs, exec: isExecutable(abs) };
    }),
  );
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
 * has no such field, and the index needs one to group the catalogue.
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
  const penguin = pkg.penguin !== null && typeof pkg.penguin === "object" ? pkg.penguin : {};
  const categories = strings(pkg.categories);
  if (categories.length === 0 && typeof penguin.category === "string")
    categories.push(penguin.category);
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
    ...(typeof penguin.description_zh === "string"
      ? { descriptionZh: penguin.description_zh }
      : {}),
    ...(typeof penguin.short_description === "string"
      ? { shortDescription: penguin.short_description }
      : {}),
    ...(typeof penguin.short_description_zh === "string"
      ? { shortDescriptionZh: penguin.short_description_zh }
      : {}),
    integrity,
  };
}

/**
 * Lays out the package at `pkgDir` — installed into the npm prefix `prefixDir` — as an entry
 * in the directory `stage`: `package/` (the package, its hoisted dependencies copied into its
 * own `node_modules`, modes normalized), then `manifest.toml`, written by `stringifyToml`.
 * `check`, when given, sees the name, version and integrity before the manifest is written,
 * and may throw. Answers the entry's name, version, integrity and manifest.
 */
export async function layOutEntry(stage, pkgDir, prefixDir, { stringifyToml, check } = {}) {
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
  const integrity = await packageIntegrity(stage);
  check?.({ name, version, integrity });
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
