/**
 * The regular files of a tar archive, read in memory: enough of the format for the tarball npm
 * serves (ustar, with pax and GNU long-name records), so the installer needs no dependency and
 * never writes an entry it did not ask for. The bytes were checked against the pinned integrity
 * before they reach this reader, so header checksums are not checked again.
 */

const BLOCK = 512;

/** One regular file of the archive. */
export interface TarFile {
  path: string;
  mode: number;
  data: Buffer;
}

/** A NUL-terminated field of a header, as text. */
function text(header: Buffer, at: number, length: number): string {
  const field = header.subarray(at, at + length);
  const end = field.indexOf(0);
  return field.subarray(0, end === -1 ? field.length : end).toString("utf8");
}

/** A numeric field: octal text, or base-256 when its first byte has the high bit set. */
function number(header: Buffer, at: number, length: number): number {
  const field = header.subarray(at, at + length);
  if ((field[0]! & 0x80) !== 0) {
    let value = field[0]! & 0x7f;
    for (let i = 1; i < field.length; i++) value = value * 256 + field[i]!;
    return value;
  }
  const digits = text(header, at, length).trim();
  return digits === "" ? 0 : Number.parseInt(digits, 8);
}

/** The `key=value` records of a pax header: `<length> <key>=<value>\n` each. */
function paxRecords(data: Buffer): Map<string, string> {
  const records = new Map<string, string>();
  let at = 0;
  while (at < data.length) {
    const space = data.indexOf(0x20, at);
    if (space === -1) break;
    const length = Number.parseInt(data.subarray(at, space).toString("utf8"), 10);
    if (!Number.isFinite(length) || length <= 0) break;
    const record = data.subarray(space + 1, at + length - 1).toString("utf8");
    const eq = record.indexOf("=");
    if (eq !== -1) records.set(record.slice(0, eq), record.slice(eq + 1));
    at += length;
  }
  return records;
}

/**
 * The archive's regular files whose path `wanted` accepts, by path. Directories, links and
 * every other entry type are skipped; a truncated archive throws.
 */
export function readTar(
  archive: Buffer,
  wanted: (path: string) => boolean = () => true,
): Map<string, TarFile> {
  const files = new Map<string, TarFile>();
  let at = 0;
  let longName: string | null = null;
  let pax: Map<string, string> | null = null;
  while (at + BLOCK <= archive.length) {
    const header = archive.subarray(at, at + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const size = number(header, 124, 12);
    const type = String.fromCharCode(header[156]!);
    const start = at + BLOCK;
    const end = start + size;
    if (end > archive.length) throw new Error("the archive is truncated");
    const data = archive.subarray(start, end);
    at = start + Math.ceil(size / BLOCK) * BLOCK;
    if (type === "x") {
      pax = paxRecords(data);
      continue;
    }
    if (type === "g") continue;
    if (type === "L") {
      longName = text(data, 0, data.length);
      continue;
    }
    const prefix = text(header, 345, 155);
    const name = text(header, 0, 100);
    const path = pax?.get("path") ?? longName ?? (prefix === "" ? name : `${prefix}/${name}`);
    longName = null;
    pax = null;
    if ((type === "0" || type === "\0") && wanted(path)) {
      files.set(path, { path, mode: number(header, 100, 8), data: Buffer.from(data) });
    }
  }
  return files;
}
