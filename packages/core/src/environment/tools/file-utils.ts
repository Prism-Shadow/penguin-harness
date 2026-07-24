/**
 * Shared helpers for the file tools (edit_file / write_file).
 */
import path from "node:path";
import { rename, rm, writeFile } from "node:fs/promises";

/**
 * Atomic file write: writes to a temp file in the target's directory, then renames it over
 * the target — a crash or full disk mid-write can no longer leave the target half-written.
 * `mode` preserves an existing file's permission bits (rename replaces the inode, which
 * would otherwise reset them); the temp file is removed on failure (best effort).
 */
export async function atomicWriteFile(
  target: string,
  content: string,
  opts: { mode?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const tmp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
  );
  try {
    await writeFile(tmp, content, {
      encoding: "utf8",
      ...(opts.mode !== undefined ? { mode: opts.mode } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    await rename(tmp, target);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}
