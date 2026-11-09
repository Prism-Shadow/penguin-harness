# Agents are drawn as a penguin in each theme's own style

- **Date:** 2026-11-04
- **Type:** feat
- **Scope:** `ui`, `web`, `ui-gallery`
- **PR:** [#1467](https://github.com/Prism-Shadow/penguin-harness/pull/1467)

[中文版](2026-11-04-theme-agent-avatars.zh.md)

An Agent without a picture of its own is no longer drawn as its initial on a tinted tile. It is drawn as a small standing penguin, the same character in every theme and recoloured per Agent, in the letter tile's calm logic: the penguin in the Agent's ink on a pale tile of the same hue, its face and belly cut out to show the tile, with two eye dots, a beak and its feet. Each theme draws the penguin in its own style, and an open page redraws it the moment the theme changes.

## Details

- Primer draws it on a rounded square, Frost as a rounder penguin on a circle, and Console as 16x16 pixel art on a square, whose cells land on whole pixels from 16 px up. A theme with no drawing of its own shows Primer's.
- The colour is one of twelve, chosen from the Agent's id by the same hash as before and rounded to the nearest of twelve hues. An Agent keeps its colour family from before, and keeps its colour across themes, modes and renames. In light mode the tile is pale and the ink dark; in dark mode the tile is a deep tint and the ink light. The ink keeps at least 4.5:1 on its tile and 3:1 against every theme's page.
- No initial is drawn. Every avatar sits beside the Agent's name or carries it on hover, and at the 14–18 px most avatars are drawn at, a letter and a penguin do not both fit.
- Company employees whose organization gave them no picture show the penguin too. User avatars and the letter tiles of custom model groups are unchanged.
- The gallery's Avatars board shows the active theme's drawing across the twelve colours, then every theme's drawing side by side, at 16, 24 and 48 px.
