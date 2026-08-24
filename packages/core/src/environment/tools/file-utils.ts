/**
 * Shared helpers for the file tools (edit_file / write_file).
 */
import path from "node:path";
import { readlink, rename, rm, writeFile } from "node:fs/promises";

/**
 * Cap on symlink hops when resolving a write target, matching the kernel's own `ELOOP`
 * budget (Linux allows 40): a link cycle has to end as an error rather than a hang.
 */
const MAX_SYMLINK_HOPS = 40;

/**
 * The path a write aimed at `target` must actually land on: the end of its symlink chain.
 *
 * Every other step of the file tools already goes through the link — `stat` reads the
 * target's size and permission bits, `readFile` reads the target's bytes — because those
 * calls dereference. The write is the one step that would not: an atomic write finishes
 * with `rename`, which operates on the link itself and would replace it with a regular
 * file, leaving the file the model set out to edit untouched while the tool reports
 * success. Following the chain here is also what makes `mode` meaningful: the bits come
 * from the dereferenced `stat`, so they have to be restored onto the same inode.
 *
 * Resolution is leaf-only and deliberate: `realpath` is not used, so a link whose target
 * does not exist yet (a dangling link, which `>` also creates through) still resolves, and
 * directory symlinks along the way are left alone — the temp file only needs to share a
 * directory with the final name for `rename` to stay atomic. A chain leaving the Workspace
 * is followed like any other: these tools already accept absolute paths anywhere, on the
 * same footing as the shell tool.
 *
 * Anything that is not a readable symlink ends the walk and is returned as-is: `EINVAL`
 * (an ordinary file — the common case, one syscall), `ENOENT` (nothing there yet, so the
 * caller creates it), or a permission error the caller's own write reports properly.
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

/**
 * Atomic file write: writes to a temp file in the target's directory, then renames it over
 * the target — a crash or full disk mid-write can no longer leave the target half-written.
 * A symlinked target is followed first (see `resolveWriteTarget`), so the write lands on
 * the file it names instead of replacing the link. `mode` preserves an existing file's
 * permission bits (rename replaces the inode, which would otherwise reset them); the temp
 * file is removed on failure (best effort).
 */
export async function atomicWriteFile(
  target: string,
  content: string,
  opts: { mode?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const resolved = await resolveWriteTarget(target);
  const tmp = path.join(
    path.dirname(resolved),
    `.${path.basename(resolved)}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
  );
  try {
    await writeFile(tmp, content, {
      encoding: "utf8",
      ...(opts.mode !== undefined ? { mode: opts.mode } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    await rename(tmp, resolved);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}
