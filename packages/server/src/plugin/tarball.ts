/**
 * The files of a package tarball, read in memory, for an install made without npm
 * (direct-install.ts): the archive `npm pack` writes and a registry serves — gzipped ustar,
 * with pax and GNU long-name records — read by the rules npm's own extraction keeps, and
 * stricter wherever a path could leave the package.
 *
 * - The archive inflates under a cap, so a small download cannot become a large allocation;
 *   a plain (uncompressed) tar is read as it is.
 * - Every header's checksum is checked: a corrupt archive is refused, never half-read.
 * - The first path segment is stripped, whatever it is named (npm's `package/`), as npm strips it.
 * - Only regular files come back. Directories are implied by the files' paths; symbolic links,
 *   hard links, devices and FIFOs are skipped, as npm's extraction skips links — nothing but a
 *   regular file is ever written from an archive.
 * - An entry whose path is absolute, climbs with `..`, or carries a backslash or a colon (a
 *   Windows separator, drive or alternate data stream) refuses the whole archive: such a
 *   tarball is hostile or broken, and installing what is left of it would be worse.
 *
 * The bytes were checked against a pinned sha512 before they reach this reader; the checks
 * here are about what a correctly signed archive may still try to write.
 */
import { gunzipSync } from "node:zlib";

/** What a package may unpack to: far past any plugin, short of an allocation that hurts. */
export const TARBALL_UNPACKED_MAX_BYTES = 256 * 1024 * 1024;
/** How many regular files a package may carry. */
export const TARBALL_MAX_FILES = 20_000;

const BLOCK = 512;

/** One regular file of the package, by its path inside the package. */
export interface TarballFile {
  data: Uint8Array;
  /** Any execute bit was set in the archive; written as 0o755, else 0o644. */
  executable: boolean;
}

/** The archive is refused; the message says why, naming the entry when one is to blame. */
export class TarballError extends Error {}

/** A NUL-terminated field of a header, as text. */
function text(block: Uint8Array, at: number, length: number): string {
  const field = block.subarray(at, at + length);
  const end = field.indexOf(0);
  return Buffer.from(field.subarray(0, end === -1 ? field.length : end)).toString("utf8");
}

/** A numeric field: octal text, or base-256 when its first byte has the high bit set. */
function number(block: Uint8Array, at: number, length: number): number {
  const field = block.subarray(at, at + length);
  if ((field[0]! & 0x80) !== 0) {
    let value = field[0]! & 0x7f;
    for (let i = 1; i < field.length; i += 1) value = value * 256 + field[i]!;
    return value;
  }
  const digits = text(block, at, length).trim();
  return digits === "" ? 0 : Number.parseInt(digits, 8);
}

/** Whether a header's stored checksum matches its bytes (the checksum field counted as spaces). */
function checksumHolds(header: Uint8Array): boolean {
  let sum = 0;
  for (let i = 0; i < BLOCK; i += 1) sum += i >= 148 && i < 156 ? 0x20 : header[i]!;
  return number(header, 148, 8) === sum;
}

/** The `key=value` records of a pax header: `<length> <key>=<value>\n` each. */
function paxRecords(data: Uint8Array): Map<string, string> {
  const records = new Map<string, string>();
  const bytes = Buffer.from(data);
  let at = 0;
  while (at < bytes.length) {
    const space = bytes.indexOf(0x20, at);
    if (space === -1) break;
    const length = Number.parseInt(bytes.subarray(at, space).toString("utf8"), 10);
    if (!Number.isFinite(length) || length <= 0 || at + length > bytes.length) break;
    const record = bytes.subarray(space + 1, at + length - 1).toString("utf8");
    const eq = record.indexOf("=");
    if (eq !== -1) records.set(record.slice(0, eq), record.slice(eq + 1));
    at += length;
  }
  return records;
}

/**
 * The path of an entry inside the package, its first segment stripped; null when nothing is
 * left (the top directory itself). Throws for a path that could land outside the package.
 */
function packagePath(raw: string): string | null {
  const unsafe = (why: string) =>
    new TarballError(`the tarball's entry ${JSON.stringify(raw)} ${why}; nothing is installed`);
  if (raw.startsWith("/") || /^[A-Za-z]:/.test(raw)) throw unsafe("is an absolute path");
  if (raw.includes("\\")) throw unsafe("carries a backslash");
  const segments = raw.split("/").filter((s) => s !== "" && s !== ".");
  if (segments.includes("..")) throw unsafe("climbs out of the package with ..");
  if (segments.some((s) => s.includes(":"))) throw unsafe("carries a colon");
  const inside = segments.slice(1);
  return inside.length === 0 ? null : inside.join("/");
}

/**
 * The regular files of a package tarball (gzipped or plain), by their path inside the package.
 * Throws a TarballError for an archive that is corrupt or truncated, inflates past
 * `maxUnpackedBytes`, carries more than `maxFiles` files, or names a path that could leave
 * the package (see the header).
 */
export function readPackageTarball(
  archive: Uint8Array,
  {
    maxUnpackedBytes = TARBALL_UNPACKED_MAX_BYTES,
    maxFiles = TARBALL_MAX_FILES,
  }: { maxUnpackedBytes?: number; maxFiles?: number } = {},
): Map<string, TarballFile> {
  let tar: Uint8Array;
  if (archive[0] === 0x1f && archive[1] === 0x8b) {
    try {
      tar = gunzipSync(archive, { maxOutputLength: maxUnpackedBytes });
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      throw new TarballError(
        code === "ERR_BUFFER_TOO_LARGE"
          ? `the tarball unpacks to more than ${Math.round(maxUnpackedBytes / 1024 / 1024)} MB; it is not installed`
          : "the tarball is not a readable gzip archive; it is not installed",
      );
    }
  } else {
    if (archive.byteLength > maxUnpackedBytes) {
      throw new TarballError(
        `the tarball unpacks to more than ${Math.round(maxUnpackedBytes / 1024 / 1024)} MB; it is not installed`,
      );
    }
    tar = archive;
  }

  const files = new Map<string, TarballFile>();
  let at = 0;
  let longName: string | null = null;
  let pax: Map<string, string> | null = null;
  while (at + BLOCK <= tar.length) {
    const header = tar.subarray(at, at + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    if (!checksumHolds(header)) {
      throw new TarballError(
        `the tarball is not a readable tar archive (a header checksum does not match at byte ${at}); it is not installed`,
      );
    }
    const type = String.fromCharCode(header[156]!);
    const declared = pax?.get("size");
    const size = declared !== undefined ? Number(declared) : number(header, 124, 12);
    const start = at + BLOCK;
    const end = start + size;
    if (!Number.isSafeInteger(size) || size < 0 || end > tar.length) {
      throw new TarballError("the tarball is truncated; it is not installed");
    }
    const data = tar.subarray(start, end);
    at = start + Math.ceil(size / BLOCK) * BLOCK;
    // Records that describe the next entry rather than being one.
    if (type === "x") {
      pax = paxRecords(data);
      continue;
    }
    if (type === "L") {
      longName = text(data, 0, data.length);
      continue;
    }
    if (type === "g" || type === "K") continue;
    // POSIX ustar splits a long path into a prefix field; GNU's magic ("ustar  ") keeps other
    // data in those bytes, so the prefix is read only under the POSIX magic.
    const posix = text(header, 257, 6) === "ustar";
    const prefix = posix ? text(header, 345, 155) : "";
    const name = text(header, 0, 100);
    const raw = pax?.get("path") ?? longName ?? (prefix === "" ? name : `${prefix}/${name}`);
    longName = null;
    pax = null;
    const inside = packagePath(raw);
    if (inside === null) continue;
    // Regular files only ("0", the old "\0", and "7", a contiguous file); every other type is
    // skipped — a directory is implied by its files, a link or a device is never created.
    if (type !== "0" && type !== "\0" && type !== "7") continue;
    files.set(inside, {
      data: Uint8Array.from(data),
      executable: (number(header, 100, 8) & 0o111) !== 0,
    });
    if (files.size > maxFiles) {
      throw new TarballError(
        `the tarball carries more than ${maxFiles} files; it is not installed`,
      );
    }
  }
  // A header cut short at the end is a truncated archive, not its end.
  if (at < tar.length && at + BLOCK > tar.length && tar.subarray(at).some((byte) => byte !== 0)) {
    throw new TarballError("the tarball is truncated; it is not installed");
  }
  return files;
}
