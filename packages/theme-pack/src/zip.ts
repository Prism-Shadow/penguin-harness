/**
 * The zip a pack travels in: `pack.json` at its root or inside one top-level folder (the rule the
 * Skill and hook zips follow), every cap enforced from the central directory before a byte is
 * inflated — fflate allocates each entry's declared size, so a cap measured on what comes back
 * would bound nothing — and every name held to a plain relative path.
 *
 * What a pack may hold is decided by name here and by content in pack.ts and assets.ts: a file
 * of any other kind (`.js`, `.html`, `.woff`, `.ttf`, a second `.json`, a dotfile, a symbolic
 * link) refuses the whole zip, naming the entry.
 */
import { unzipSync, zipSync } from "fflate";
import { MANIFEST_FILE } from "./manifest.js";
import { THEME_PACK_LIMITS } from "./limits.js";
import { invalid, tooLarge } from "./problem.js";

/** A pack's files by their path in the pack, `/`-separated. */
export type PackFiles = Map<string, Uint8Array>;

/** One path segment: letters, digits, `.`, `_`, `-`, not starting with a dot. */
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
const STYLESHEET = /^(?:tokens|recipes|accents|fonts)\.css$|^sections\/[a-z][a-z0-9-]*\.css$/;
const DOC = /^(?:README\.md|LICENSE[A-Za-z0-9._-]*|LICENSES\/[A-Za-z0-9._-]+\.txt)$/;

export type EntryKind = "manifest" | "stylesheet" | "font" | "art" | "doc";

/** What a path in a pack is, or null when a pack may not hold it. */
export function entryKind(path: string): EntryKind | null {
  if (path === MANIFEST_FILE) return "manifest";
  if (STYLESHEET.test(path)) return "stylesheet";
  if (/^fonts\/.+\.woff2$/.test(path)) return "font";
  if (/^art\/.+\.(?:svg|png|webp)$/.test(path)) return "art";
  if (DOC.test(path)) return "doc";
  return null;
}

/** The most one entry of a kind may declare. */
const CAP: Record<EntryKind, number> = {
  manifest: THEME_PACK_LIMITS.manifestBytes,
  stylesheet: THEME_PACK_LIMITS.cssBytes,
  font: THEME_PACK_LIMITS.fontBytes,
  art: THEME_PACK_LIMITS.imageBytes,
  doc: THEME_PACK_LIMITS.docBytes,
};

/** Why a path is not one a pack may hold, or null. */
function pathProblem(path: string): string | null {
  if (path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    return "is not a relative path";
  }
  if (!path.split("/").every((segment) => SEGMENT.test(segment))) {
    return "has a name a pack may not hold: plain letters, digits, '.', '_' and '-', no dotfiles";
  }
  if (entryKind(path) === null) {
    return "is not a file a pack may hold (pack.json, the stylesheets, fonts/*.woff2, art/*.svg|png|webp, README.md, LICENSE*, LICENSES/*.txt)";
  }
  return null;
}

/**
 * The names of the zip's symbolic links, read from its central directory: a Unix host's entry
 * whose mode says `S_IFLNK`. fflate hands a link back as a file holding its target, so it is
 * caught by name here instead.
 */
function symbolicLinks(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let at = bytes.byteLength - 22; at >= Math.max(0, bytes.byteLength - 22 - 0xffff); at--) {
    if (view.getUint32(at, true) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) return [];
  const links: string[] = [];
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const names = new TextDecoder();
  for (let i = 0; i < count && at + 46 <= bytes.byteLength; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    const host = view.getUint8(at + 5);
    const mode = view.getUint32(at + 38, true) >>> 16;
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    if (host === 3 && (mode & 0xf000) === 0xa000) {
      links.push(names.decode(bytes.subarray(at + 46, at + 46 + nameLength)));
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return links;
}

/**
 * The files of an uploaded zip by their path in the pack, the top-level folder (when the zip has
 * one) stripped. Throws the refusal for a cap it breaks, an entry it may not hold, or a zip that
 * does not read.
 */
export function readPackArchive(bytes: Uint8Array): PackFiles {
  if (bytes.byteLength > THEME_PACK_LIMITS.archiveBytes) {
    throw tooLarge("(zip)", `the zip is over ${THEME_PACK_LIMITS.archiveBytes / 1024 / 1024} MiB`);
  }
  if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw invalid("(zip)", "the upload is not a zip archive");
  }
  const [link] = symbolicLinks(bytes);
  if (link !== undefined) throw invalid(link, "a symbolic link is refused");
  let files = 0;
  let declared = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: ({ name, originalSize }) => {
        if (name.endsWith("/")) return false;
        files += 1;
        if (files > THEME_PACK_LIMITS.entries) {
          throw tooLarge("(zip)", `the zip holds over ${THEME_PACK_LIMITS.entries} files`);
        }
        declared += originalSize;
        if (declared > THEME_PACK_LIMITS.unpackedBytes) {
          throw tooLarge(
            "(zip)",
            `the zip unpacks to over ${THEME_PACK_LIMITS.unpackedBytes / 1024 / 1024} MiB`,
          );
        }
        return true;
      },
    });
  } catch (err) {
    if (err instanceof Error && err.name === "ThemePackError") throw err;
    throw invalid(
      "(zip)",
      `the zip does not read (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  const names = Object.keys(entries);
  const top = names.includes(MANIFEST_FILE) ? "" : topFolder(names);
  if (top === null) {
    throw invalid(
      MANIFEST_FILE,
      "the zip has no pack.json at its root or inside one top-level folder",
    );
  }
  const out: PackFiles = new Map();
  for (const name of names.sort()) {
    if (!name.startsWith(top)) throw invalid(name, "sits outside the pack's folder");
    const path = name.slice(top.length);
    const problem = pathProblem(path);
    if (problem !== null) throw invalid(path, problem);
    const data = entries[name]!;
    const kind = entryKind(path)!;
    if (data.byteLength > CAP[kind]) {
      throw tooLarge(path, `is over ${CAP[kind] / 1024} KiB, the most a ${kind} file may be`);
    }
    out.set(path, data);
  }
  return out;
}

/** `<folder>/` when every name sits in one top-level folder holding pack.json, else null. */
function topFolder(names: string[]): string | null {
  const first = names[0]?.split("/")[0];
  if (first === undefined || names.some((name) => !name.startsWith(`${first}/`))) return null;
  return names.includes(`${first}/${MANIFEST_FILE}`) ? `${first}/` : null;
}

/** A fixed modification time, so the same files always make the same archive. */
const ARCHIVE_MTIME = new Date(Date.UTC(2026, 0, 1));

/** A zip of `files` at its root, in path order. */
export function writePackArchive(files: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const entries: Record<string, [Uint8Array, { mtime: Date }]> = {};
  for (const path of [...files.keys()].sort())
    entries[path] = [files.get(path)!, { mtime: ARCHIVE_MTIME }];
  return zipSync(entries, { level: 6 });
}
