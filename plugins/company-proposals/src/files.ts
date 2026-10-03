/**
 * One file of the working tree, read for the proposal page's file panel. The plugin runs on the
 * server that owns the organization, so the proposal's `base` (the shared workspace joined with
 * its `root`) is a local directory. The read is confined to it: an absolute path or a `..`
 * segment is refused before anything is touched, and the canonical path — symlinks followed —
 * must still be inside the canonical base.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { ProposalFileResponse } from "@prismshadow/penguin-server/api";

/** At most this much of a file is sent. */
export const FILE_READ_LIMIT = 512 * 1024;
/** A NUL byte within this prefix makes a file binary. */
const BINARY_PROBE = 8 * 1024;

export type FileReadError =
  | { code: "bad_path"; message: string }
  | { code: "path_outside"; message: string }
  | { code: "file_not_found"; message: string };

/** The request's path as `/`-separated segments, or the reason it is refused. */
export function relativeSegments(rel: string): string[] | FileReadError {
  const segments = rel.split(/[\\/]+/).filter((s) => s !== "" && s !== ".");
  if (
    rel === "" ||
    path.isAbsolute(rel) ||
    path.win32.isAbsolute(rel) ||
    rel.includes("\0") ||
    segments.length === 0
  ) {
    return { code: "bad_path", message: `Not a path relative to the proposal's root: ${rel}` };
  }
  if (segments.includes("..")) {
    return { code: "bad_path", message: `A path may not contain \`..\`: ${rel}` };
  }
  return segments;
}

const inside = (dir: string, target: string): boolean => {
  const rel = path.relative(dir, target);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

/** Read `rel` under `base`, or say why not. */
export async function readBaseFile(
  base: string,
  rel: string,
): Promise<ProposalFileResponse | FileReadError> {
  const segments = relativeSegments(rel);
  if (!Array.isArray(segments)) return segments;
  const shown = segments.join("/");
  const missing: FileReadError = { code: "file_not_found", message: `No such file: ${shown}` };
  let realBase: string;
  let real: string;
  try {
    realBase = await fs.realpath(base);
    real = await fs.realpath(path.join(base, ...segments));
  } catch {
    return missing;
  }
  if (!inside(realBase, real)) {
    return { code: "path_outside", message: `The path leaves the proposal's root: ${shown}` };
  }
  const handle = await fs.open(real, "r").catch(() => null);
  if (handle === null) return missing;
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) return missing;
    const length = Math.min(stat.size, FILE_READ_LIMIT);
    const buf = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const { bytesRead } = await handle.read(buf, read, length - read, read);
      if (bytesRead === 0) break;
      read += bytesRead;
    }
    const bytes = buf.subarray(0, read);
    const binary = bytes.subarray(0, BINARY_PROBE).includes(0);
    const ext = path.extname(segments.at(-1)!).slice(1).toLowerCase();
    return {
      path: shown,
      size: stat.size,
      binary,
      truncated: stat.size > read,
      // A cut can split a multi-byte character; the decoder renders it as U+FFFD at the end.
      content: binary ? null : bytes.toString("utf8"),
      extension: ext,
    };
  } finally {
    await handle.close();
  }
}
