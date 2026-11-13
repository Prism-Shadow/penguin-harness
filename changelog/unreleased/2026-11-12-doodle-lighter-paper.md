# Doodle's light paper is lighter

- **Date:** 2026-11-12
- **Type:** fix
- **Scope:** `ui`
- **PR:** [#1541](https://github.com/Prism-Shadow/penguin-harness/pull/1541)

[中文版](2026-11-12-doodle-lighter-paper.zh.md)

The Doodle (卡通) theme pack's light mode moved from a beige paper to a lighter, warm off-white one, so the page no longer reads as dark. The ink, the pen lines, the pills and every tone stay as they were; dark mode is unchanged.

## Details

- The paper `--ui-canvas` went from `#f6f1e7` to `#fbf9f4`, the slip `--ui-surface` from `#fcf9f2` to `#fefdf9`, and the pad `--ui-surface-muted` (the sidebar and the desktop title band) from `#f3ede3` to `#f6f3ec`. The surfaces derived from them followed: `--ui-inset` `#f7f4ee`, `--ui-fill-neutral` `#ede7db`, `--ui-overlay` `#fffefb`, `--ui-code-bg` `#f5f1e8`, and the gray bridge's 50 and 100 steps. The pack's light swatch follows the new paper.
- Text keeps WCAG AA on every paper surface. Body ink is at least 12.3:1 and muted at least 5.9:1; subtle is 4.6:1 on the pad and higher on the paper and the slip.
- The floating slips' pre-drawn images (dialogs, menus, popovers, toasts, the composer) were redrawn in the new overlay by `scripts/draw-doodle-edges.mjs`.
