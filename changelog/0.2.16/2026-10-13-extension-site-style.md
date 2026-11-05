# Chrome extension: the site's look, with language and theme that follow the device

- **Date:** 2026-10-13
- **Type:** feature
- **Scope:** `browser-extension`, `docs`
- **PR:** [#1091](https://github.com/Prism-Shadow/penguin-harness/pull/1091)

[中文版](2026-10-13-extension-site-style.zh.md)

The PenguinHarness Browser extension's options page and toolbar popup took the look of penguin.ooo, and their language and light or dark theme now follow the device until the user picks one.

## Details

- Both pages gained the site's header: its logo and the product name on the left, a language switch and a theme switch on the right. The colours are the site's: neutral greys, one brand blue for links and the toolbar badge, near-black primary buttons (light grey in dark), 8px radii. Sections stay ruled rather than boxed.
- With nothing picked, the pages and the toolbar title are in Chrome's UI language: Chinese for any `zh-*` locale, English for any other. They used to stay English whatever the browser's language.
- The language switch offers English, 中文 and System; the theme switch steps through Light, Dark and System, as the site's does. Under System the pages follow the device's light or dark setting as it changes.
- A pick is stored in `chrome.storage.local` (`uiLanguage`, which now also takes `system`, and the new `uiTheme`), and every open page of the extension follows it at once. An English or 中文 picked with the old switch is kept.
- The manifest's name and description still come from `_locales`, which Chrome picks by its own language.
- The docs' built-in browser page describes the new defaults and the two switches.
