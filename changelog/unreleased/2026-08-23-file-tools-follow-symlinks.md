# edit_file and write_file follow a symlink instead of replacing it

- **Date:** 2026-08-23
- **Type:** fix
- **Scope:** `core`, `docs`
- **PR:** [#414](https://github.com/Prism-Shadow/penguin-harness/pull/414)

[中文版](2026-08-23-file-tools-follow-symlinks.zh.md)

Editing or writing a symlinked path replaced the link with a regular file and left the
file it pointed at untouched — while reporting success, complete with a diff of a change
that never reached the real file. `stat` and `readFile` dereference, so the tools read the
target's content and permission bits correctly; only the final `rename` of the atomic
write acted on the link itself. Both tools now resolve the link chain first and write to
the file at its end, so the link survives and the content lands where it points.

## Details

- `resolveWriteTarget` walks the chain with `readlink` (bounded at 40 hops, the kernel's
  own `ELOOP` budget) and returns the first path that is not a readable link. A cycle
  fails with "Too many levels of symbolic links" instead of hanging.
- Resolution is leaf-only rather than a `realpath`: a link whose target does not exist yet
  still resolves, so `write_file` creates that file — and its parent directory — the way a
  shell redirect through a dangling link would. Directory symlinks along the path are left
  alone; the temp file only needs to share a directory with the final name for the rename
  to stay atomic.
- The temp file is now created beside the resolved target, keeping the rename within one
  filesystem when the link crosses mount points.
- Preserving the overwritten file's permission bits becomes meaningful with this: the bits
  come from the dereferenced `stat`, and are now restored onto that same inode.
- A chain that leaves the Workspace is followed like any other path — these tools already
  accept absolute paths anywhere, on the same footing as the shell tool.
