/**
 * A plugin package's index row and integrity, shared by scripts/build-plugins.mjs and the
 * server (plugin/install.ts, plugin/registry.ts). `integrity` is npm's `dist.integrity` of the
 * tarball (`tarballIntegrity`); once a tarball is unpacked into a prefix's
 * `node_modules/<name>/`, it is kept beside the package as INTEGRITY_FILE. Plain JavaScript:
 * the build runs it directly; types in plugin-entry.d.mts. Design: PRFC-0006.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";

/** A prefix's index of the plugins it carries or lists, beside its `node_modules/`. */
export const INDEX_FILE = "index.json";
/** An unpacked package's record of the tarball it came from: its integrity, one line. */
export const INTEGRITY_FILE = ".integrity";

/** `sha512-<base64 of 64 bytes>`: npm's `dist.integrity`. */
export const INTEGRITY = /^sha512-[A-Za-z0-9+/]{86}==$/;

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** npm's integrity of a tarball file: `sha512-<base64>` of its bytes (what `dist.integrity` is). */
export async function tarballIntegrity(file) {
  const hash = createHash("sha512");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return `sha512-${hash.digest("base64")}`;
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
  const categories = strings(pkg.categories);
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
    integrity,
  };
}

/** Index rows in the order an index is written: name, then version, then integrity. */
export function sortIndex(entries) {
  return [...entries].sort(
    (a, b) =>
      byCodeUnit(a.name, b.name) ||
      byCodeUnit(a.version, b.version) ||
      byCodeUnit(a.integrity, b.integrity),
  );
}
