# Windows program installation folder

- **Date:** 2026-11-23
- **Type:** fix
- **Scope:** `desktop`
- **PR:** [#1758](https://github.com/Prism-Shadow/penguin-harness/pull/1758)

[中文版](2026-11-23-windows-program-directory.zh.md)

The Windows desktop installer shows the final program path when you browse for a folder. Selecting a drive or parent folder places the program in a `penguinharness` subfolder. Updates reuse the existing program directory. The uninstaller removes the installed program files and leaves other files in place.

See [compatibility with existing installations](2026-11-23-backward-compatibility.md) for legacy custom folders.
