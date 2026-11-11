# Agents are drawn as a smiling ball penguin, in each theme's style

- **Date:** 2026-11-04
- **Type:** feat
- **Scope:** `ui`, `web`, `ui-gallery`
- **PR:** [#1467](https://github.com/Prism-Shadow/penguin-harness/pull/1467)

[中文版](2026-11-04-theme-agent-avatars.zh.md)

An Agent without a picture of its own is no longer drawn as its initial on a tinted tile. It is drawn as a smiling ball penguin: one round shape that is the whole penguin, a dark hood over a broad pale face, bead eyes, a tiny beak, a smile and two nub flippers. Every Agent wears the same smile; its colour, one of twelve from its id, is its own. Each theme draws the penguin in its own style, and an open page redraws it the moment the theme changes.

## Details

- Primer draws it on a rounded square, Frost and Doodle on a circle, and Console as 16x16 pixel art on a square, whose cells land on whole pixels from 16 px up. A theme with no drawing of its own shows Primer's.
- The smile shows at every size. Below 32 px the face is two bold dots and one wide smile, without the beak, which at those sizes blurs into the smile; from 32 px up the beak sits above the smile. The blush on the cheeks shows from 20 px, and a catch-light in the eyes from 48 px.
- The colour is one of twelve, chosen from the Agent's id by the same hash as before and rounded to the nearest of twelve hues, so an Agent keeps its colour family from before, and keeps its colour across themes, modes and renames. In light mode the penguin is the hue's dark ink with a pale face; in dark mode it keeps a penguin's colouring, a mid-tone coat with a near-white face and dark eyes. The coat keeps at least 3:1 on its tile and against every theme's page, and the eyes at least 4.5:1 on the face.
- No initial is drawn. Every avatar sits beside the Agent's name or carries it on hover, and at the 14–18 px most avatars are drawn at, a letter and a penguin do not both fit.
- Company employees whose organization gave them no picture show the penguin too. User avatars and the letter tiles of custom model groups are unchanged.
- The gallery's Avatars board shows twelve Agents in the active theme's drawing, then every theme's drawing side by side, at 16, 24, 48 and 96 px.
