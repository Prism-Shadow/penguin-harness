# Thinking and compaction bodies read as output, not as a quotation

- **Date:** 2026-09-11
- **Type:** fix
- **Scope:** `web`
- **PR:** [#694](https://github.com/Prism-Shadow/penguin-harness/pull/694)

[中文版](2026-09-11-thinking-body-output-style.zh.md)

## Details

- An expanded thinking block, and both sections of a compaction banner, sat in an inset
  rounded box on a tinted ground — the shape the transcript uses for a quotation. They now
  wear the block an expanded `exec_command` output wears: full-bleed under their row,
  separated from it by the same divider, inset by the same padding, in the same ink. The type
  stays at prose size: the output block is monospace, and the app's sans at that size reads
  visibly smaller beside it. Paragraph, list and heading spacing now lands on one rhythm, and
  the body's own padding is the whole gap at each end. Both bodies still render Markdown, and
  neither takes the output block's height cap: they stream, and a nested scrollbox would
  strand the tail the transcript's own follow scrolls to.
