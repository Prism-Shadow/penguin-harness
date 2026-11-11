# Agents are drawn as a ball penguin with a face of their own, in each theme's style

- **Date:** 2026-11-04
- **Type:** feat
- **Scope:** `ui`, `web`, `ui-gallery`
- **PR:** [#1467](https://github.com/Prism-Shadow/penguin-harness/pull/1467)

[中文版](2026-11-04-theme-agent-avatars.zh.md)

An Agent without a picture of its own is no longer drawn as its initial on a tinted tile. It is drawn as a ball penguin: one round shape that is the whole penguin, a dark hood over a broad pale face, a tiny beak and two nub flippers. Every Agent gets one of twelve colours and one of five friendly faces, both from its id, so it looks the same on every render, after a reload and in every theme. Each theme draws the penguin in its own style, and an open page redraws it the moment the theme changes.

## Details

- The faces: bead eyes, happy closed eyes (^ ^), a wink, bead eyes with a small smile, and relaxed closed eyes. The face comes from different bits of the id's hash than the colour, so two Agents of one colour can wear different faces.
- Primer draws it on a rounded square, Frost and Doodle on a circle, and Console as 16x16 pixel art on a square, whose cells land on whole pixels from 16 px up. A theme with no drawing of its own shows Primer's.
- Below 20 px the face keeps what still reads: bead eyes stay dots, closed eyes become short dashes, and the smile and the blush on the cheeks are left out. The eyes carry a catch-light from 48 px up.
- The colour is one of twelve, chosen from the Agent's id by the same hash as before and rounded to the nearest of twelve hues, so an Agent keeps its colour family from before, and keeps its colour across themes, modes and renames. In light mode the penguin is the hue's dark ink with a pale face; in dark mode it keeps a penguin's colouring, a mid-tone coat with a near-white face and dark eyes. The coat keeps at least 3:1 on its tile and against every theme's page, and the eyes at least 4.5:1 on the face.
- No initial is drawn. Every avatar sits beside the Agent's name or carries it on hover, and at the 14–18 px most avatars are drawn at, a letter and a penguin do not both fit.
- Company employees whose organization gave them no picture show the penguin too. User avatars and the letter tiles of custom model groups are unchanged.
- The gallery's Avatars board shows twelve Agents in the active theme's drawing, one for each face, then every theme's drawing side by side, at 16, 24, 48 and 96 px.
