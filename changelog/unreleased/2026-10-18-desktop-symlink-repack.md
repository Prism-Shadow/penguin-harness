# The `penguin` symlink is repaired on every Node 24 patch release

- **Date:** 2026-10-18
- **Type:** fix
- **Scope:** `desktop`

[中文版](2026-10-18-desktop-symlink-repack.zh.md)

`writeSymlink` removed a symlink at the link's path with `fs.unlinkSync` instead of `fs.rmSync`.
On Node 24.0.0–24.13.0 `rmSync` left a dangling symlink in place without throwing and threw
`ERR_FS_EISDIR` on a symlink pointing at a directory, so the link that most needed repairing — the
one left dangling by a launch from the dmg or by a moved app — could not be repacked and the
`symlinkSync` that followed failed with `EEXIST`.

## Details

- `unlinkSync` removed the link itself on every Node version and never followed it, so a directory
  the link pointed at kept its contents. Other entries still went through `rmSync`, so a real
  directory at the target path was still refused with `ERR_FS_EISDIR` and left untouched.
- The macOS automatic install and the menu item's forced install both took the repaired path. The
  forced install could replace a file, but it never removed a directory.
