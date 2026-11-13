# `penguin` symlink repair no longer relies on `rmSync` removing a symlink

- **Date:** 2026-10-18
- **Type:** fix
- **Scope:** `desktop`
- **PR:** [#1201](https://github.com/Prism-Shadow/penguin-harness/pull/1201)

[中文版](2026-10-18-desktop-symlink-unlink.zh.md)

`writeSymlink`, the macOS half of the automatic `penguin` command install, removed an existing
symlink at the link's path with `fs.unlinkSync` instead of `fs.rmSync`. On Node 24.0.0–24.13.0
(nodejs/node [#61020](https://github.com/nodejs/node/issues/61020), fixed in 24.13.1) `rmSync` left
a dangling symlink in place without throwing and threw `ERR_FS_EISDIR` on a symlink pointing at a
directory, so the link that most needed repairing — the one left dangling by a launch from the dmg
or by a moved app — could not be replaced and the `symlinkSync` that followed failed with `EEXIST`.
This hardened the development and test path: shipped builds ran on the Node bundled with Electron
43.2.0 (24.18.0), which already carried the upstream fix, so no installed app was affected; the
desktop test suite, which runs on the developer's own Node, failed the same way on those versions.

## Details

- `unlinkSync` removed the link itself on every Node version and never followed it, so a directory
  the link pointed at kept its contents. Other entries still went through `rmSync`, so a real
  directory at the target path was still refused with `ERR_FS_EISDIR` and left untouched.
- The macOS automatic install and the menu item's forced install both took the repaired path. The
  forced install could replace a file, but it never removed a directory.
