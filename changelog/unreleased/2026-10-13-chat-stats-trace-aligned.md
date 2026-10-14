# Chat details card: token and elapsed breakdowns behind a "?", as in the Trace view

- **Date:** 2026-10-13
- **Type:** feature
- **Scope:** `web`
- **PR:** [#1095](https://github.com/Prism-Shadow/penguin-harness/pull/1095)

[中文版](2026-10-13-chat-stats-trace-aligned.zh.md)

The statistics in the chat page's details card now read like the Trace view's overview: every total carries its breakdown behind a circled "?" to the right of it, drawn by the same breakdown rows.

## Details

- Total Tokens gained a "?" listing cached input, uncached input and output in Tokens, each with its share of the total. The cache hit rate stays inline in the parentheses after the total.
- Elapsed dropped its inline `(API …, tools …)` parenthetical for a "?" listing model API time and tool wall time with their shares of the elapsed time, as the Trace overview's Elapsed row does.
- The cache hit rate is computed and formatted by the same helpers as the Trace view's.
