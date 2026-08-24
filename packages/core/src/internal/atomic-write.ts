/**
 * Atomic file replacement: the shared writer for every file the Harness keeps on disk.
 *
 * A plain `writeFile` truncates the target before it writes, so a crash or a full disk part-way
 * through leaves the file half-written. For a state file that is worse than losing the write —
 * a truncated `system_config.yaml` can still parse as YAML (the cut lands inside the
 * `system_prompt` block scalar) and the Agent then boots with everything after it silently
 * missing. Writing to a temporary file in the same directory and renaming it over the target
 * makes the replacement a single atomic step: a reader sees the old bytes or the new ones.
 */
import path from "node:path";
import { chmod, lstat, readlink, rename, rm, writeFile } from "node:fs/promises";

/** Symlink hops `followSymlinks` resolves before giving up and writing to the last name it reached. */
const MAX_SYMLINK_HOPS = 8;

export interface AtomicWriteOptions {
  /**
   * Permission bits for the result. Rename replaces the inode, so an existing file's bits are
   * not inherited — pass them (or the intended mode for a secret) to keep them. Applied with an
   * explicit chmod, which the umask does not mask, so `0o600` really is `0o600`.
   */
  mode?: number;
  signal?: AbortSignal;
  /**
   * Write through a symlink standing at `target` — what a plain `writeFile` does, and what a
   * user who linked their config into a dotfiles repository expects. Left off, the rename
   * replaces the link with a regular file: the right behavior where the directory is
   * model-writable and a link planted there would carry the write outside it.
   */
  followSymlinks?: boolean;
}

/** Writes `content` to `target` atomically. The temp file is removed on failure (best effort). */
export async function atomicWriteFile(
  target: string,
  content: string | Uint8Array,
  opts: AtomicWriteOptions = {},
): Promise<void> {
  const dest = opts.followSymlinks === true ? await resolveSymlink(target) : target;
  const tmp = path.join(
    path.dirname(dest),
    `.${path.basename(dest)}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
  );
  try {
    await writeFile(tmp, content, {
      ...(typeof content === "string" ? { encoding: "utf8" as const } : {}),
      ...(opts.mode !== undefined ? { mode: opts.mode } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
      // Rename orders the directory entry, not the data behind it: without this fsync a power
      // loss can commit the new name over blocks that never reached the disk, which is the
      // zero-length file the whole exercise is meant to prevent.
      flush: true,
    });
    if (opts.mode !== undefined) await chmod(tmp, opts.mode);
    await rename(tmp, dest);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

/**
 * The path a symlink chain ends at, resolved one hop at a time so a link pointing at a file that
 * does not exist yet still resolves (realpath would throw). A name that is not a link, or a chain
 * longer than the hop limit, resolves to itself.
 */
async function resolveSymlink(target: string): Promise<string> {
  let current = target;
  for (let hop = 0; hop < MAX_SYMLINK_HOPS; hop++) {
    const stat = await lstat(current).catch(() => null);
    if (stat === null || !stat.isSymbolicLink()) return current;
    current = path.resolve(path.dirname(current), await readlink(current));
  }
  return current;
}
