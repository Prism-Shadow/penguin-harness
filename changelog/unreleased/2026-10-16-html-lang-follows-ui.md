# The document language tag follows the interface language

- **Date:** 2026-10-16
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1212](https://github.com/Prism-Shadow/penguin-harness/pull/1212)

[中文版](2026-10-16-html-lang-follows-ui.zh.md)

The document root's `lang` attribute now mirrors the interface language, so an English screen
reads as English. It used to say `zh-CN` no matter which of English, Chinese or "follow the
system" was on screen: it was a static literal in `index.html` and nothing in the app ever
rewrote it, so screen readers announced the wrong language and translation and word-breaking
heuristics treated every page as Chinese.

## Details

- The effective locale — `en` or `zh`, with "system" resolved through the device language
  first — is stamped on the root in the same render pass that switches the active dictionary,
  so the tag never disagrees with the text on screen, on a switch and after a reload alike.
- `zh` is announced as `zh-CN` (the Simplified-Chinese dictionary), `en` as plain `en`.
- The write goes through `applyDocumentLang(document, locale)`, a small exported function
  parameterized by its document, so the node-environment unit suite covers the tag mapping and
  the write without a DOM.
