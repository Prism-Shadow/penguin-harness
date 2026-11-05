# Frost's sidebar became flat, and gradients stayed only where they have a job

- **Date:** 2026-10-11
- **Type:** fix
- **Scope:** `ui`, `web`, `ui-gallery`
- **PR:** [#1038](https://github.com/Prism-Shadow/penguin-harness/pull/1038)

[中文版](2026-10-11-frost-flat-sidebar.zh.md)

Frost (白领), the default theme, had painted its navigation column over a colour field with two radial washes, sky blue from the top and lilac from the bottom. Following the owner's call that the sidebar take no gradient and that gradients in the UI be used with restraint, the field became one flat colour, and every gradient in the UI package, the Web App and the gallery's chrome was reviewed: the ones that carry data, a state or one deliberate emphasis stayed, and the decorative ones were removed.

## Details

- **The sidebar:** the field behind the window became flat in both modes, and the navigation column stayed the frosted glass over it, with its hairline edge, its lit inner edge and the opaque muted fill under reduced transparency. In light mode the field took the gray-200 step, so the column came out at `#f4f5f6`, a shade under the `#fafafa` canvas. In dark mode the field took the muted surface, so the column came out at `#232427`, near the card surface and a step above the `#1b1c1e` canvas. The two wash tokens, `--ui-shell-wash-1` and `--ui-shell-wash-2`, were removed from the token contract and from all three themes.
- **Removed as decoration:** the soft glow under the streaming reply's veil, which sat on the middle of the text block wherever its newest words were.
- **Kept, each with its job:** the highlight sweeping across a running step's label in Frost, the one signal that the step is in progress; the streaming veil itself, under which the newest lines are the faintest; a chart area's fade towards its baseline; the hatch on the context bar past the compaction threshold, which marks the room compaction fires before; and the highlight sweeping across the brand name in the models page's TokenDance banner, a deliberate emphasis on the brand name and the one emphasis the banner carries, which the owner confirmed on 2026-10-12. Product logos were left as drawn.
- **The rule was tightened:** de-slop rule 18 stopped allowing the shell's recipe a gradient, and its statement became: a gradient only where it carries the data's shape, a state transition or one deliberate emphasis, never as atmosphere or decoration. The frontend skill (`.agents/skills/penguin-harness-frontend/SKILL.md`) and the de-slop reference gained the principle and the five gradients that stay.
- The gallery's streaming copy stopped mentioning the glow.
