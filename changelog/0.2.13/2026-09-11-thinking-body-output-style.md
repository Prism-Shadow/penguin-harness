# Thinking and compaction bodies read as output, not as a quotation

- **Date:** 2026-09-11
- **Type:** fix
- **Scope:** `web`
- **PR:** [#694](https://github.com/Prism-Shadow/penguin-harness/pull/694)

[中文版](2026-09-11-thinking-body-output-style.zh.md)

An expanded thinking block, and both sections of a compaction banner, sat in an inset rounded box
on a tinted ground — the shape the transcript uses for a quotation. Both now wear the block an
expanded `exec_command` output wears.

## Details

- The body runs full-bleed under its row, separated from it by the same divider, inset by the same
  padding, in the same ink.
- That padding is the whole gap at each end: the outermost paragraph, list or heading no longer
  adds its own margin on top of it, and paragraph, list and heading spacing lands on one rhythm.
- The type stays at prose size rather than the output block's, and both bodies still render
  Markdown.
- Neither body takes the output block's height cap: a long body grows the transcript instead of
  scrolling inside itself.
