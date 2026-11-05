/**
 * What a zip's entries are, beyond the bytes fflate hands back: the names no disk keeps as they
 * are, the entries recorded as something other than a regular file or a directory, and the
 * central directory itself, read from a file on disk without loading the archive. Shared by the
 * archive imports that write an upload's entries to disk as files (the workbench and Benchmark
 * archives, and the Agent archive).
 *
 * A name is judged the way the strictest disk an Agent State travels to judges it: letter case
 * and Unicode normal form folded, as macOS and Windows compare names, and Windows' own rules on
 * what a name may hold.
 */
import fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { strFromU8 } from "fflate";
import { badRequest } from "../http/errors.js";

/**
 * A control character, NUL above all: no disk takes NUL in a name, and a name holding any other
 * one never lists as it is (a newline splits it, an escape sequence redraws the terminal).
 */
export const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;

/** A name as a disk that ignores letter case and Unicode normal form (macOS, Windows) compares it. */
export function folded(name: string): string {
  return name.normalize("NFC").toLowerCase();
}

/** Windows reserves these device names, with or without an extension, in any letter case. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
/** Characters no Windows name holds. */
const WINDOWS_FORBIDDEN = /[<>:"|?*]/;
/** The longest name a disk keeps, in UTF-8 bytes. */
const MAX_SEGMENT_BYTES = 255;

/** One path segment Windows cannot hold as it is (forbidden characters, a device name, a trailing dot or space, too long). */
export function isWindowsUnsafeSegment(segment: string): boolean {
  return (
    WINDOWS_FORBIDDEN.test(segment) ||
    WINDOWS_RESERVED.test(segment) ||
    /[. ]$/.test(segment) ||
    Buffer.byteLength(segment) > MAX_SEGMENT_BYTES
  );
}

/**
 * Every path an extraction will hold, as a disk that folds names sees it: two entries it takes
 * for one would land one over the other, and a file where another entry needs a directory would
 * fail the write half-way. `prefix` is put back in front of a path the error names.
 */
export function assertDistinct(rels: Iterable<string>, prefix: string): void {
  const claimed = new Map<string, { rel: string; directory: boolean }>();
  const claim = (rel: string, directory: boolean): void => {
    const key = folded(rel);
    const prior = claimed.get(key);
    if (prior === undefined) {
      claimed.set(key, { rel, directory });
    } else if (prior.directory !== directory) {
      throw badRequest(
        `Zip entry is both a file and a directory: ${prefix}${directory ? prior.rel : rel}`,
      );
    } else if (prior.rel !== rel) {
      throw badRequest(
        `Zip entry has the same name as ${prefix}${prior.rel} where letter case is ignored: ${prefix}${rel}`,
      );
    }
  };
  for (const rel of rels) {
    const segments = rel.split("/");
    for (let i = 1; i < segments.length; i++) claim(segments.slice(0, i).join("/"), true);
    claim(rel, false);
  }
}

/** One entry of a zip's central directory: what it claims about itself before a byte is read. */
export interface ZipDirectoryEntry {
  name: string;
  /** 0 stored, 8 deflated; anything else is refused by the readers here. */
  method: number;
  /** The general-purpose flags; bit 0 means encrypted. */
  flags: number;
  crc32: number;
  compressedSize: number;
  /** The declared uncompressed size. */
  size: number;
  /** Where the entry's local header starts. */
  localHeaderOffset: number;
  /** Recorded as something other than a regular file or a directory (a symbolic link above all). */
  special: boolean;
}

/** Where the central directory is, from the end-of-central-directory record in `tail`. */
interface DirectoryEnd {
  count: number;
  size: number;
  offset: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
/** The end-of-central-directory record: 22 bytes, then a comment of up to 64KB, at the very end. */
const EOCD_SIZE = 22;
const MAX_COMMENT = 0xffff;

function findEnd(tail: Uint8Array): DirectoryEnd | null {
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  for (let i = tail.byteLength - EOCD_SIZE; i >= 0; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      return {
        count: view.getUint16(i + 10, true),
        size: view.getUint32(i + 12, true),
        offset: view.getUint32(i + 16, true),
      };
    }
  }
  return null;
}

/** Parses `count` central-directory records from `bytes` (which starts at the first one); stops at the first malformed one. */
function parseRecords(bytes: Uint8Array, count: number): ZipDirectoryEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: ZipDirectoryEntry[] = [];
  let at = 0;
  for (let n = 0; n < count && at + 46 <= bytes.byteLength; n++) {
    if (view.getUint32(at, true) !== CENTRAL_SIGNATURE) break;
    const host = view.getUint8(at + 5);
    const flags = view.getUint16(at + 8, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const type = (view.getUint32(at + 38, true) >>> 16) & 0o170000;
    out.push({
      name: strFromU8(bytes.subarray(at + 46, at + 46 + nameLength), (flags & 0x800) === 0),
      method: view.getUint16(at + 10, true),
      flags,
      crc32: view.getUint32(at + 16, true),
      compressedSize: view.getUint32(at + 20, true),
      size: view.getUint32(at + 24, true),
      localHeaderOffset: view.getUint32(at + 42, true),
      // Only the central directory says so: a Unix zipper (host 3) keeps the entry's `st_mode`
      // in the high half of its external attributes. An archive made elsewhere records no type
      // there, and its entries are plain files.
      special: host === 3 && type !== 0 && type !== 0o100000 && type !== 0o040000,
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return out;
}

/**
 * The entries a zip records as something other than a regular file or a directory — a symbolic
 * link above all. The directory is not re-validated here; this runs after fflate has read the
 * same archive without complaint.
 */
export function specialEntries(zip: Uint8Array): string[] {
  const tail = zip.subarray(Math.max(0, zip.byteLength - EOCD_SIZE - MAX_COMMENT));
  const end = findEnd(tail);
  if (end === null || end.offset >= zip.byteLength) return [];
  return parseRecords(zip.subarray(end.offset), end.count)
    .filter((entry) => entry.special)
    .map((entry) => entry.name);
}

/** What `readZipDirectory` refuses beyond a malformed directory. */
export interface ZipDirectoryLimits {
  /** Entries the directory may list, directories included. */
  maxEntries: number;
  /** The error a broken cap throws, given its message. */
  tooLarge: (message: string) => Error;
}

/**
 * Reads the central directory of the zip at `file`, reading only its end: the last 64KB to find
 * the directory, then the directory itself. Everything an import decides before inflating — the
 * names, the declared sizes, which entries are links — is answered here. Refused with a 400: a
 * file that is not a zip, a directory that does not parse, a zip64 archive (no archive within the
 * caps needs one), an encrypted entry or a compression method other than stored or deflated.
 */
export async function readZipDirectory(
  file: string,
  limits: ZipDirectoryLimits,
): Promise<ZipDirectoryEntry[]> {
  const handle = await fs.open(file, "r");
  try {
    const { size } = await handle.stat();
    const tailLength = Math.min(size, EOCD_SIZE + MAX_COMMENT);
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tailLength, size - tailLength);
    const end = findEnd(tail);
    if (end === null) throw badRequest("The archive is not a valid zip file.");
    if (end.count === 0xffff || end.size === 0xffffffff || end.offset === 0xffffffff) {
      throw limits.tooLarge("Zip64 archives are not supported; the archive is past the limits.");
    }
    if (end.count > limits.maxEntries) {
      throw limits.tooLarge(`The archive exceeds the ${limits.maxEntries}-entry limit.`);
    }
    if (end.offset + end.size > size) throw badRequest("The archive is not a valid zip file.");
    const directory = Buffer.alloc(end.size);
    await handle.read(directory, 0, end.size, end.offset);
    const entries = parseRecords(directory, end.count);
    if (entries.length !== end.count) throw badRequest("The zip's central directory is damaged.");
    for (const entry of entries) {
      if ((entry.flags & 0x1) !== 0) {
        throw badRequest(`Encrypted zip entries are not supported: ${entry.name}`);
      }
      if (entry.method !== 0 && entry.method !== 8) {
        throw badRequest(`Unsupported compression method ${entry.method}: ${entry.name}`);
      }
      if (entry.size === 0xffffffff || entry.compressedSize === 0xffffffff) {
        throw limits.tooLarge(`Zip entry is past the size limits: ${entry.name}`);
      }
    }
    return entries;
  } finally {
    await handle.close();
  }
}

/**
 * Where an entry's compressed bytes start: past its local header, whose name and extra field
 * lengths may differ from the central directory's copy.
 */
export async function entryDataOffset(
  handle: FileHandle,
  entry: ZipDirectoryEntry,
): Promise<number> {
  const header = Buffer.alloc(30);
  const { bytesRead } = await handle.read(header, 0, 30, entry.localHeaderOffset);
  if (bytesRead !== 30 || header.readUInt32LE(0) !== 0x04034b50) {
    throw badRequest(`The zip's local header is damaged: ${entry.name}`);
  }
  return entry.localHeaderOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
}
