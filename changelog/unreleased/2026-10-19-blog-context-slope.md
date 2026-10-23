# A perspective post on controlling context slope

- **Date:** 2026-10-19
- **Type:** process
- **Scope:** `landing`
- **PR:** [#1239](https://github.com/Prism-Shadow/penguin-harness/pull/1239)

[中文版](2026-10-19-blog-context-slope.zh.md)

The blog gained a perspective post, in English and Chinese, "Design context slope down before you rely
on compaction" (`context-slope`). It names context slope, how much an agent's context grows with each
request, as the number a harness controls before compaction. Each request's context splits into an
intercept that every request carries and a slope that each step adds, and one principle, "index
first, fetch on demand", runs through progressive Skill loading, the disk-backed output cap, CLI
output and MCP tool definitions; the post ends on the rule for MCP tool sets.

## Details

- The post is one argued essay with a three-point TL;DR and one bold key sentence in the lead and in
  each section; a transition round rewrote only the sentences at the headings.
- `context-slope` carries four figures drawn as inline SVG with the shared figure styles: estimated
  context size per request for a synthetic run with and without the 16,000-character output cap,
  the estimated size of each Skill content tier in the shipped library, the path of over-cap tool
  output to the context and to the recovery file, and three MCP designs side by side.
- The two charts plot numbers measured on a synthetic test with the repository's prompt-cache test
  helpers; sizes are character-based estimates, not provider token counts.
- Sources are cited as numbered footnotes: at most one per paragraph, each source once, and the same
  7 sources in both languages.
- The landing blog test lists the post first among the perspectives.
