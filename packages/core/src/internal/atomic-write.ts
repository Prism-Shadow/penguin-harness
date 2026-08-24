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
import { chmod, readlink, rename, rm, writeFile } from "node:fs/promises";

/**
 * Cap on symlink hops when resolving a write target, matching the kernel's own `ELOOP`
 * budget (Linux allows 40): a link cycle has to end as an error rather than a hang.
 */
const MAX_SYMLINK_HOPS = 40;

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
   * user who linked their config into a dotfiles repository expects (see
   * `resolveWriteTarget`). Left off, the rename replaces the link with a regular file: the
   * right behavior where the directory is model-writable and a link planted there would
   * carry the write outside it.
   */
  followSymlinks?: boolean;
}

/** Writes `content` to `target` atomically. The temp file is removed on failure (best effort). */
export async function atomicWriteFile(
  target: string,
  content: string | Uint8Array,
  opts: AtomicWriteOptions = {},
): Promise<void> {
  const dest = opts.followSymlinks === true ? await resolveWriteTarget(target) : target;
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
 * The path a write aimed at `target` must actually land on: the end of its symlink chain.
 *
 * For the file tools (edit_file / write_file) every other step already goes through the link —
 * `stat` reads the target's size and permission bits, `readFile` reads the target's bytes —
 * because those calls dereference. The write is the one step that would not: it finishes with
 * `rename`, which operates on the link itself and would replace it with a regular file, leaving
 * the file the model set out to edit untouched while the tool reports success. Following the
 * chain here is also what makes `mode` meaningful: the bits come from the dereferenced `stat`,
 * so they have to be restored onto the same inode. A config file a user symlinked into a
 * dotfiles repository wants the same treatment, which is why the state writers opt in too.
 *
 * Resolution is leaf-only and deliberate: `realpath` is not used, so a link whose target does
 * not exist yet (a dangling link, which `>` also creates through) still resolves, and directory
 * symlinks along the way are left alone — the temp file only needs to share a directory with the
 * final name for `rename` to stay atomic. A chain leaving the Workspace is followed like any
 * other: these tools already accept absolute paths anywhere, on the same footing as the shell
 * tool.
 *
 * Anything that is not a readable symlink ends the walk and is returned as-is: `EINVAL` (an
 * ordinary file — the common case, one syscall), `ENOENT` (nothing there yet, so the caller
 * creates it), or a permission error the caller's own write reports properly.
 */
export async function resolveWriteTarget(target: string): Promise<string> {
  let current = target;
  for (let hop = 0; hop < MAX_SYMLINK_HOPS; hop += 1) {
    let link: string;
    try {
      link = await readlink(current);
    } catch {
      return current;
    }
    current = path.resolve(path.dirname(current), link);
  }
  throw new Error(`Too many levels of symbolic links: "${target}"`);
}
