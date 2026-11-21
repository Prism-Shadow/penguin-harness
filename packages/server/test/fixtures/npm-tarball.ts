/**
 * Package tarballs written byte by byte, the way `npm pack` lays them out (gzipped ustar, every
 * path under `package/`), including the entries no packer would write — a path that climbs out,
 * an absolute one, a symbolic link, a device — so a test can hand an installer exactly the
 * archive a hostile registry would serve. Paths longer than a ustar name field ride a pax record.
 */
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

export interface TarEntry {
  /** The path exactly as the header carries it (no `package/` added). */
  path: string;
  data?: string | Uint8Array;
  type?: "file" | "dir" | "symlink" | "hardlink" | "fifo" | "chardev";
  mode?: number;
  /** A link's target. */
  linkTo?: string;
  /** A raw type flag, for the records no packer writes by hand (`L`, `g`, `K`). */
  typeflag?: string;
  /** Edits the header before its checksum is computed (another magic, a base-256 size). */
  patch?: (header: Uint8Array) => void;
  /** Breaks the header's checksum after it is computed. */
  corrupt?: boolean;
}

const TYPE_FLAG: Record<NonNullable<TarEntry["type"]>, string> = {
  file: "0",
  hardlink: "1",
  symlink: "2",
  chardev: "3",
  dir: "5",
  fifo: "6",
};

const encoder = new TextEncoder();
const bytesOf = (data: string | Uint8Array | undefined) =>
  data === undefined ? new Uint8Array() : typeof data === "string" ? encoder.encode(data) : data;

function header(
  path: string,
  size: number,
  type: string,
  mode: number,
  linkTo = "",
  patch?: (header: Uint8Array) => void,
): Uint8Array {
  const block = new Uint8Array(512);
  const put = (at: number, text: string) => block.set(encoder.encode(text), at);
  const octal = (value: number, width: number) => `${value.toString(8).padStart(width - 1, "0")}\0`;
  put(0, path.slice(0, 100));
  put(100, octal(mode, 8));
  put(108, octal(0, 8));
  put(116, octal(0, 8));
  put(124, octal(size, 12));
  put(136, octal(0, 12));
  put(148, "        ");
  put(156, type);
  put(157, linkTo.slice(0, 100));
  put(257, "ustar\0");
  put(263, "00");
  patch?.(block);
  let sum = 0;
  for (const byte of block) sum += byte;
  put(148, `${sum.toString(8).padStart(6, "0")}\0 `);
  return block;
}

const padded = (data: Uint8Array) => {
  const out = new Uint8Array(Math.ceil(data.byteLength / 512) * 512);
  out.set(data);
  return out;
};

/** A tar archive of `entries`, gzipped unless `gzip` is false. */
export function tarball(entries: readonly TarEntry[], { gzip = true } = {}): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const entry of entries) {
    const type = entry.typeflag ?? TYPE_FLAG[entry.type ?? "file"];
    const data =
      type === "0" || entry.typeflag !== undefined ? bytesOf(entry.data) : new Uint8Array();
    const mode = entry.mode ?? (type === "5" ? 0o755 : 0o644);
    if (encoder.encode(entry.path).byteLength > 100) {
      const record = (() => {
        const body = ` path=${entry.path}\n`;
        let length = body.length;
        while (`${length}${body}`.length !== length) length = `${length}${body}`.length;
        return encoder.encode(`${length}${body}`);
      })();
      blocks.push(header("././@PaxHeader", record.byteLength, "x", 0o644), padded(record));
    }
    const block = header(entry.path, data.byteLength, type, mode, entry.linkTo, entry.patch);
    if (entry.corrupt === true) block[0] = block[0]! ^ 0x01;
    blocks.push(block, padded(data));
  }
  blocks.push(new Uint8Array(1024));
  const tar = new Uint8Array(blocks.reduce((n, b) => n + b.byteLength, 0));
  let at = 0;
  for (const block of blocks) {
    tar.set(block, at);
    at += block.byteLength;
  }
  return gzip ? new Uint8Array(gzipSync(tar)) : tar;
}

/** A package's tarball as npm packs it: `files` (relative paths) under `package/`. */
export function packageTarball(files: Record<string, string | Uint8Array>): Uint8Array {
  return tarball(Object.entries(files).map(([rel, data]) => ({ path: `package/${rel}`, data })));
}

/** The `sha512-<base64>` integrity npm records for `bytes`. */
export function integrityOf(bytes: Uint8Array): string {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}
