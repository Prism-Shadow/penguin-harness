/**
 * The container the install image travels in.
 *
 * Not tar, and not zip: the far side unpacks it with a script of ours running on a runtime we
 * just put there, and neither format is available to that script without a dependency (Node
 * ships gzip, not tar). A format we define is ~40 lines on each end, has no long-path or
 * extension edge cases, and carries exactly what an install needs — the bytes, the relative
 * path, and whether the file is executable.
 *
 * Layout, all inside one gzip stream:
 *
 *     [4 bytes, big-endian] header length
 *     [header]              JSON: { schemaVersion, entries: [{ path, size, mode }] }
 *     [bytes]               each entry's contents, in header order
 *
 * The embedded remote installer (installer-script.ts) carries the reader; keep the two in step.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

export const PACK_SCHEMA_VERSION = 1;

export interface PackEntry {
  /** Path relative to the pack root, always with forward slashes. */
  path: string;
  size: number;
  /** POSIX mode bits; only the executable bit is meaningful when unpacking on Windows. */
  mode: number;
}

export interface PackHeader {
  schemaVersion: number;
  entries: PackEntry[];
}

/** Files under `root`, depth first, with directories flattened away (they are recreated on unpack). */
function walk(root: string, prefix = ""): PackEntry[] {
  const out: PackEntry[] = [];
  for (const entry of fs
    .readdirSync(path.join(root, prefix), { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    const full = path.join(root, rel);
    if (entry.isDirectory()) {
      out.push(...walk(root, rel));
    } else if (entry.isFile()) {
      const stat = fs.statSync(full);
      out.push({ path: rel, size: stat.size, mode: stat.mode & 0o777 });
    }
    // Symlinks are skipped on purpose: the deploy tree is hoisted and has none, and following
    // one would silently pull in something from outside the image.
  }
  return out;
}

/**
 * Packs a directory tree into one gzip buffer.
 *
 * `prefix` puts every entry under one top-level directory in the pack — packing a server's
 * own install root (`…/penguin/{bin,lib}`) into the `penguin/…` shape the installer expects,
 * without copying the tree first. `exclude` drops subtrees by pack-relative path (before the
 * prefix): `lib/runtime` keeps this machine's own Node out of a universal image.
 */
export function packDirectory(
  root: string,
  opts: { prefix?: string; exclude?: string[] } = {},
): Buffer {
  const excluded = opts.exclude ?? [];
  const entries = walk(root)
    .filter((entry) => !excluded.some((ex) => entry.path === ex || entry.path.startsWith(`${ex}/`)))
    .map((entry) =>
      opts.prefix === undefined ? entry : { ...entry, path: `${opts.prefix}/${entry.path}` },
    );
  const header = Buffer.from(
    JSON.stringify({ schemaVersion: PACK_SCHEMA_VERSION, entries } satisfies PackHeader),
    "utf8",
  );
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.byteLength);
  const parts: Buffer[] = [length, header];
  const stripPrefix = opts.prefix === undefined ? 0 : opts.prefix.length + 1;
  for (const entry of entries) {
    parts.push(fs.readFileSync(path.join(root, entry.path.slice(stripPrefix))));
  }
  return zlib.gzipSync(Buffer.concat(parts), { level: 6 });
}

/**
 * Reads a pack into a directory. The installer has its own copy of this logic (it cannot
 * import from here); this one exists for the tests that prove the two agree.
 */
export function unpackTo(pack: Buffer, destDir: string): PackEntry[] {
  const raw = zlib.gunzipSync(pack);
  const headerLength = raw.readUInt32BE(0);
  const header = JSON.parse(raw.subarray(4, 4 + headerLength).toString("utf8")) as PackHeader;
  if (header.schemaVersion !== PACK_SCHEMA_VERSION) {
    throw new Error(`unsupported pack schema ${header.schemaVersion}`);
  }
  let offset = 4 + headerLength;
  for (const entry of header.entries) {
    const target = path.join(destDir, ...entry.path.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, raw.subarray(offset, offset + entry.size));
    // Executable bit only: the rest of the mode is the remote user's umask business.
    if ((entry.mode & 0o111) !== 0) fs.chmodSync(target, 0o755);
    offset += entry.size;
  }
  return header.entries;
}
