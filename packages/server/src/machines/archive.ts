/**
 * The containers a pushed install travels in: a real `payload.tar.gz` (POSIX remotes) or
 * `payload.zip` (Windows remotes), byte-for-byte the shape a release payload has — which is
 * what lets the ordinary installers (install.sh, install.ps1) run the far side of a push
 * instead of an installer of our own.
 *
 * Written here rather than shelled out, for one reason each way: the executable bit must be
 * set by RULE (a Windows server packing for a Linux remote has no mode bits to preserve), and
 * a Linux server packing for a Windows remote has no zip tool to lean on. Reading stays with
 * the system where the system can do it; only the zip READER below exists because GNU tar
 * cannot open the nodejs.org win-x64 archive.
 *
 * Deterministic on purpose: fixed timestamps, sorted walks — the same tree packs to the same
 * bytes, so a checksum names a build rather than a moment.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

/** One file to be packed. */
export interface PackFile {
  /** Archive-relative path, forward slashes. */
  path: string;
  data: Buffer;
  /** POSIX mode bits; defaults to a plain file. Only the executable bit matters. */
  mode?: number;
}

/**
 * Files under `root`, sorted, as pack files. `prefix` puts them under one top-level archive
 * directory; `exclude` drops subtrees by root-relative path (before the prefix). Symlinks are
 * skipped on purpose: the trees packed here are hoisted deploys with none, and following one
 * would silently pull in something from outside the image.
 */
export function filesFromDirectory(
  root: string,
  opts: { prefix?: string; exclude?: string[] } = {},
): PackFile[] {
  const excluded = opts.exclude ?? [];
  const out: PackFile[] = [];
  const walk = (rel: string): void => {
    for (const entry of fs
      .readdirSync(path.join(root, rel), { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const entryRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (excluded.some((ex) => entryRel === ex || entryRel.startsWith(`${ex}/`))) continue;
      if (entry.isDirectory()) {
        walk(entryRel);
      } else if (entry.isFile()) {
        const full = path.join(root, entryRel);
        out.push({
          path: opts.prefix === undefined ? entryRel : `${opts.prefix}/${entryRel}`,
          data: fs.readFileSync(full),
          mode: fs.statSync(full).mode & 0o777,
        });
      }
    }
  };
  walk("");
  return out;
}

// --- tar.gz --------------------------------------------------------------------------------

/** Writes one number as tar's NUL-terminated octal, left-padded to fit the field. */
function octal(value: number, width: number): Buffer {
  return Buffer.from(value.toString(8).padStart(width - 1, "0") + "\0", "ascii");
}

/**
 * One ustar header. Paths longer than 100 bytes are split at a `/` into ustar's prefix+name
 * pair (up to 155+100), which covers everything a payload holds; a path that cannot split is
 * refused rather than silently truncated.
 */
function tarHeader(file: PackFile): Buffer {
  let name = file.path;
  let prefix = "";
  if (Buffer.byteLength(name) > 100) {
    // Split at the last '/' that leaves the name part within 100 bytes.
    for (let at = name.length - 101; at < name.length; at++) {
      if (name[at] === "/" && Buffer.byteLength(name.slice(at + 1)) <= 100) {
        prefix = name.slice(0, at);
        name = name.slice(at + 1);
        break;
      }
    }
    if (prefix === "" || Buffer.byteLength(prefix) > 155) {
      throw new Error(`path too long for a ustar header: ${file.path}`);
    }
  }
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  octal(file.mode ?? 0o644, 8).copy(header, 100);
  octal(0, 8).copy(header, 108); // uid
  octal(0, 8).copy(header, 116); // gid
  octal(file.data.byteLength, 12).copy(header, 124);
  octal(0, 12).copy(header, 136); // mtime: fixed, for reproducible payloads
  header.write("        ", 148, 8, "ascii"); // checksum field is spaces while summing
  header.write("0", 156, 1, "ascii"); // type: regular file
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  header.write(prefix, 345, 155, "utf8");
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
  return header;
}

/** The files as one gzipped ustar archive. */
export function tarGzBytes(files: PackFile[]): Buffer {
  const parts: Buffer[] = [];
  for (const file of files) {
    parts.push(tarHeader(file), file.data);
    const spill = file.data.byteLength % 512;
    if (spill !== 0) parts.push(Buffer.alloc(512 - spill));
  }
  parts.push(Buffer.alloc(1024)); // end-of-archive: two zero blocks
  return zlib.gzipSync(Buffer.concat(parts), { level: 6 });
}

/** Entry list of a tar.gz produced here — the writer's inverse, for tests. */
export function tarGzEntries(archive: Buffer): { path: string; size: number; mode: number }[] {
  const raw = zlib.gunzipSync(archive);
  const out: { path: string; size: number; mode: number }[] = [];
  let at = 0;
  while (at + 512 <= raw.byteLength) {
    const block = raw.subarray(at, at + 512);
    if (block.every((byte) => byte === 0)) break;
    const field = (start: number, width: number): string =>
      block
        .subarray(start, start + width)
        .toString("utf8")
        .replace(/\0.*$/, "");
    const size = parseInt(field(124, 12), 8);
    const prefix = field(345, 155);
    out.push({
      path: prefix === "" ? field(0, 100) : `${prefix}/${field(0, 100)}`,
      size,
      mode: parseInt(field(100, 8), 8),
    });
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

// --- zip -----------------------------------------------------------------------------------

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * The files as one zip, every entry deflated. Fixed DOS timestamps for the same reason the
 * tar writer has them. Sizes stay under the zip32 limits by a wide margin — a payload is tens
 * of megabytes — so there is no zip64 here, deliberately.
 */
export function zipBytes(files: PackFile[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.path, "utf8");
    const packed = zlib.deflateRawSync(file.data, { level: 6 });
    const crc = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    local.writeUInt16LE(8, 8); // method: deflate
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // date: 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.byteLength, 18);
    local.writeUInt32LE(file.data.byteLength, 22);
    local.writeUInt16LE(name.byteLength, 26);
    locals.push(local, name, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.byteLength, 20);
    central.writeUInt32LE(file.data.byteLength, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.byteLength + packed.byteLength;
  }
  const centralStart = offset;
  const centralSize = centrals.reduce((sum, buf) => sum + buf.byteLength, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralStart, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/**
 * One entry's bytes out of a zip — enough to lift `node.exe` from the nodejs.org win-x64
 * archive on a server whose tar cannot read zips. Handles the two methods nodejs.org uses
 * (store and deflate) and nothing else.
 */
export function zipExtract(archive: Buffer, entryPath: string): Buffer | null {
  // End-of-central-directory: scan back over at most one comment's worth of tail.
  let eocd = -1;
  const floor = Math.max(0, archive.byteLength - 22 - 0xffff);
  for (let at = archive.byteLength - 22; at >= floor; at--) {
    if (archive.readUInt32LE(at) === 0x06054b50) {
      eocd = at;
      break;
    }
  }
  if (eocd === -1) return null;
  let at = archive.readUInt32LE(eocd + 16);
  const count = archive.readUInt16LE(eocd + 10);
  for (let i = 0; i < count; i++) {
    if (archive.readUInt32LE(at) !== 0x02014b50) return null;
    const method = archive.readUInt16LE(at + 10);
    const packedSize = archive.readUInt32LE(at + 20);
    const nameLength = archive.readUInt16LE(at + 28);
    const extraLength = archive.readUInt16LE(at + 30);
    const commentLength = archive.readUInt16LE(at + 32);
    const headerOffset = archive.readUInt32LE(at + 42);
    const name = archive.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    if (name === entryPath) {
      // The local header repeats the lengths; trust its own name/extra sizes for the offset.
      const localName = archive.readUInt16LE(headerOffset + 26);
      const localExtra = archive.readUInt16LE(headerOffset + 28);
      const start = headerOffset + 30 + localName + localExtra;
      const packed = archive.subarray(start, start + packedSize);
      return method === 0 ? Buffer.from(packed) : zlib.inflateRawSync(packed);
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}
