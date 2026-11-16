# The gallery measures every theme pack against Frost, and lists the packs' manifests

- **Date:** 2026-11-10
- **Type:** feat
- **Scope:** `ui-gallery`
- **PR:** [#1528](https://github.com/Prism-Shadow/penguin-harness/pull/1528)

[中文版](2026-11-10-theme-packs-gallery.zh.md)

The gallery's browser checks now hold every built-in theme pack to Frost's cleanliness budget, and its Foundations section gains a Theme packs page listing each pack's manifest.

## The cleanliness budget

- A new check opens five app surfaces — the start page, a finished conversation, a running one, the model library and the usage page — at 1280 × 800, light, English, under a fixed clock and reduced motion, once under Frost and once under every other pack in the registry, in the same run. A pack fails when it draws a box around a kind of element Frost leaves unboxed, puts a kind of text on a texture where Frost has none, or uses more than one line colour beyond Frost's. A kind is an element's tag, classes, slot and role, which every pack renders alike, so a denser pack that fits more of the same cards on screen draws nothing new.
- Two edges do not count: a control's — a form control or an interactive widget, by tag or ARIA role; a box whose own child is a text field, such as the composer; a `ui-edge` host — and a floating layer's own, a `ui-glass` host other than a tile or the navigation backdrop. Text inside the running work step, whose label sweep carries its state, is not texture.
- Frost is measured each run, never stored, so the budget moves with Frost. A pack is held from the day it is registered. Primer already boxed the work group and the notice, which Frost leaves unboxed, when the check came in; it is held to exactly those, pending the product owner's decision, and every other pack, Console and Doodle included, to none.
- The counter is `packages/ui-gallery/scripts/cleanliness.mjs`, which also runs on its own and prints each pack's numbers on each surface. Its rules have their own check, on a small page of known shapes.

## The Theme packs page

- Foundations › Theme packs tables each pack's `pack.json`: its names in both languages, what it builds on, its version, the theme API it targets, a swatch per mode painted from the manifest's colours, and the face each font role puts first.
- The built-in packs come from the registry, in its order. Under them are the packs an admin imported on the demo's server, read through the Web App's `GET /api/themes` wrapper and marked Imported; today that is one fixture, Paper.
- The gallery bar's theme control offers one segment per built-in pack, in the registry's order. Every theme name in the gallery is now read from the pack's manifest rather than from the gallery's dictionaries.
