# The CLI no longer prints half an emoji where it cuts text short

- **Date:** 2026-11-07
- **Type:** fix
- **Scope:** `cli`
- **PR:** [#1504](https://github.com/Prism-Shadow/penguin-harness/pull/1504)

[中文版](2026-11-07-cli-cut-on-code-points.zh.md)

Several CLI outputs cut text to a fixed length, and the cut counted UTF-16 units. An emoji is two units, so a cut that fell between them left a lone half, which the terminal prints as `�`. This happened in `penguin session ls` (a renamed title over 40 characters), `penguin agent ls` (a description over 60), a tool call's streamed preview and its approval payload, and `penguin browser` (a tab title in the `tabs` table and on the `tabs:` line, a clicked element's text, a dialog's message, an exec return value, and a `cdp` result). Each of these cuts now stops before an emoji that would straddle it. The limits are unchanged.
