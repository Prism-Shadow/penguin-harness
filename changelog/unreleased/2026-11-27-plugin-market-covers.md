# Plugin market covers redrawn as one lit set, from a generator in this repository

- **Date:** 2026-11-27
- **Type:** feature
- **Scope:** `server`, `ui`, `tooling`
- **PR:** [#1929](https://github.com/Prism-Shadow/penguin-harness/pull/1929)

[中文版](2026-11-27-plugin-market-covers.zh.md)

Redrew the cover of every plugin the plugin market names, and replaced the covers this build ships
under `packages/server/src/plugin/market-covers/`. Each cover is now one subject built
from the plugin's own domain objects, in white, on a field of the plugin's hue lit from the upper
left, with the same light, shadow and corners across the set; covers carry no screenshots and no
product logo, and the subject sits inside the square a 1:1 crop keeps.

## Details

- `scripts/market-cover-art/`: the generator. `covers.mjs` maps each plugin to a template or scene
  and its hue, `kit.mjs` holds the palette, the lit field and the shadowed objects, `scenes.mjs`
  the drawings, and `build.mjs` writes the SVG sources and the WebP files (1280 × 720 and
  640 × 360) through the repository's Playwright Chromium. With `--community` it also writes every
  cover, and its `tone`, into a checkout of the community repository. Its README describes the
  system, the safe area and the export rules.
- The RSI toolkits' covers set the method's name large, in Mona Sans, over the RSI loop; the sandbox
  backends share a shield emblem in four shades of slate.
- The generated cover the market draws for a plugin without a picture uses the same lit field and a
  white tile with a soft shadow, at the authored covers' lightness in every theme and mode.
