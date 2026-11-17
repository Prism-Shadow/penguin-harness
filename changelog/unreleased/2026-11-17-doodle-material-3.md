# Doodle is redrawn after Material 3

- **Date:** 2026-11-17
- **Type:** feature
- **Scope:** `ui`, `ui-gallery`, `web`
- **PR:** [#1578](https://github.com/Prism-Shadow/penguin-harness/pull/1578)

[中文版](2026-11-17-doodle-material-3.zh.md)

The Doodle (卡通) theme pack was redrawn element by element after Material 3 and M3 Expressive, in the pack's own material: paper, cut paper in the pen's washes, and a felt-tip line where a person puts their hand. Frost, Primer and Console did not change.

## Details

- **The pen is a colour.** The pack's own accent went from the ink to the ballpoint blue (`#2c4f9e`; `#8fb0ec` in dark), and the ink became a preset in its place (`ink`); a stored `ballpoint` choice shows the pack's own pen, the same blue. The pen's wash under the person's own words went from 8% to 16% in light. The pad, the neutral fill, the faint line and the neutral badge carry a cast of the pen, as Material 3's neutrals carry their key's.
- **The ink dot in dark.** In Settings → Appearance in dark mode, the swatch of a preset that is the pack's own light ink (Doodle's `ink`) is painted in the pack's dark ink, so the dot shows on a dark row.
- **Paper.** The window became a desk pad in a flat pastel of the pen (a tenth of it on white), and the main column a sheet of plain warm paper laid on it: set 0.5rem down from the window's top on one 1.25rem corner, flush on the right and at the foot. Both are one flat colour; nothing is drawn behind a page.
- **Navigation.** The row the reader is on (a page's, the open conversation's) takes the pen's pale fill, the one a selected row takes in every other list, where it took a wash of the ink. New chat became Material 3's extended FAB in the pen's container. Decorative icons are drawn in the pen's colour.
- **Buttons.** Every button became a capsule at any height; a select's or a date picker's trigger keeps the text field's box. The four kinds read apart: filled (`primary`), tonal (`secondary`, the pen's container), outlined (`danger`, redrawn in the danger ink on hover) and text (`ghost`, `link`). A capsule is a hair smaller while it is held down. A segmented control's chosen option is a tonal capsule.
- **Cards and notices.** A card, a table's box, a code block, a tool card and the agent's work group became Material 3's filled card: a tone off the paper, no line. A notice in the page is a filled container with no shadow.
- **Shapes.** The scale became Material 3's (4 / 8 / 12 / 16 / 28 px). The person's bubble has three round corners and one tight. A dialog and the composer take the extra-large corner, a menu the medium one. An Agent's avatar is cut to a nine-sided cookie and a plugin's or a skill's tile to a four-leaf clover.
- **Type and motion.** The first heading rung went to 2rem in the heaviest cut, and the display title takes it. A layer arrives on M3 Expressive's fast spatial spring and is not blurred. A switch's knob is the small one while off. A chart's bars are a flat fill outlined in the ink.
- **The pen line.** `scripts/draw-doodle-edges.mjs` draws a felt tip (1.7–2.2 px, wandering up to 0.8 px) and four new drawings: the capsule, the bead, the asymmetric bubble and the FAB, with the cookie and the clover as clip shapes and the two larger slips.
- **Two hooks.** `ui-segmented` (the segmented control) and `ui-action` (the primary action that heads a navigation list; `NavRow` and `RailItem` take `primary`) joined the closed list, and a `Button` names its variant in `data-variant`. The base, Primer and Console draw none of them differently.
- **The clean baseline.** Doodle alone is allowed past rules R1 and R7 of the pack rules and rule 2 of the de-slop rules, by exact count; an imported pack is still held to no hit.

## Compatibility

- The stored theme id (`doodle`) and every stored accent choice keep working; nothing is migrated.
- Someone who never picked a pen in Doodle now sees the ballpoint blue where they saw the ink. Picking Ink (`ink`) in Settings → Appearance brings the ink back.
- An export of Doodle now carries recipes the clean baseline refuses an import, as Console's export does: importing a copy of it means clearing those first.
