# A multi-line notice keeps its tone dot on the first line

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `ui`
- **PR:** [#1897](https://github.com/Prism-Shadow/penguin-harness/pull/1897)

[中文版](2026-11-26-notice-dot-first-line.zh.md)

## Details

- The shared `Notice` now keeps its tone mark on the first line of text instead of centring it on the whole box, so a notice that wraps, or has a title over its body (such as the plugin market's expanded source-failure notice), no longer shows the mark beside a middle line. The Frost, Console and Doodle themes draw that mark in CSS, so they now anchor it to the notice's leading block (the new `lead` slot of `ui-notice`); the real glyph of the GitHub theme sits on the first line too. A one-line notice, with or without buttons, looks as before.
- The UI gallery's Notice board gains a multi-line example.
