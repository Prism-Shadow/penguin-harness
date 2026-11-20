# App Center folders open from their icons

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `web`, `ui`, `ui-gallery`
- **PR:** [#1622](https://github.com/Prism-Shadow/penguin-harness/pull/1622)

[中文](2026-11-19-app-center-folders.zh.md)

App and folder icons use softly rounded squares that keep their shape in miniature. Open a folder in the App Center and its preview icons spread into a grid in place, with no backdrop. The back arrow, Escape, a press outside or the browser's Back folds it back into place. The open folder is part of the address (`?folder=<id>`), so closing a workbench returns to the folder it came from. With reduced motion enabled, the folder opens and closes immediately.

## Details

- The folder's surface became a shared component, `UnfoldSurface`: placement inside a scroll area, the clipped and travelling endpoints, Escape, outside dismissal, focus return and the exit after the fold. The theme's layout timing and both reduced-motion signals drive its motion.
- The icon mask became a shared component, `AppIconShape`, whose corner is the theme's large radius capped at 12px and scales with the icon's size.
- The component gallery gained a board section for each: an unfolding folder in a short scroll area (Dialogs), and the icon shape at four sizes with a letter tile and a folder (Avatars).
