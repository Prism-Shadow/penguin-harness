# Backward compatibility: the gallery's remembered light/dark and language

- **Date:** 2026-10-13
- **Type:** process
- **Scope:** `ui-gallery`
- **PR:** [#1101](https://github.com/Prism-Shadow/penguin-harness/pull/1101)

[中文版](2026-10-13-backward-compatibility-gallery-prefs.zh.md)

The gallery remembered light/dark and the language in the browser under its own keys, `penguin-gallery.mode` and `penguin-gallery.lang`. With [the site's navbar](2026-10-13-gallery-site-nav.md) they are the site's, kept under `penguin-site.theme` and `penguin-site.lang` as on the landing page and the docs.

## Scope

While both site keys are empty, a visit still reads the gallery's two older keys, so a returning reader opens in the mode and language they last picked in the gallery. Nothing writes the older keys any more, and the site keys win as soon as any of the three sites sets them. Readers do nothing.

## Removal

At the 0.3.0 release preparation, by whoever prepares it: drop the fallback to the older `mode` and `lang` in `rememberedPrefs` (`packages/ui-gallery/src/lib/url-state.ts`) and its test scenario. A reader who has only the older keys then opens once in the system's mode and language.
