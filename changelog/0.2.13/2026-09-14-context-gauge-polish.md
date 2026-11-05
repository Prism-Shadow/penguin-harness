# The context panel reads better while the cutter is dragged

- **Date:** 2026-09-14
- **Type:** fix
- **Scope:** `web`
- **PR:** [#723](https://github.com/Prism-Shadow/penguin-harness/pull/723)

[中文版](2026-09-14-context-gauge-polish.zh.md)

## What changed

- The value that floats under the compaction cutter while it is dragged (or arrowed) now uses the panel's own text size instead of a ten-pixel chip that was hard to read mid-gesture.
- The stretch of the bar to the right of the cutter, up to the model window, is hatched: it is room the model has but compaction fires before the Session can use, so it no longer looks like the plain free run left of the cutter. The hatching follows the pending value while the cutter moves, the coloured fills still draw over it, and hovering it says what it is.
- Bar segments and the six legend rows are clickable: a click pins the highlight — the segment and its row together — until the same item is clicked again or another one is picked, so a highlight survives the pointer moving away. The legend rows are real buttons, so the pin is reachable by keyboard, and a pinned row carries a ring the hover tint does not draw — a pin and a passing pointer are told apart without moving away. Hover still wins while it lasts; the tool and file rankings stay hover-only.
