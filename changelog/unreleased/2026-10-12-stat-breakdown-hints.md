# Stat breakdowns sit behind a circled "?" on the totals; cost splits by bucket

- **Date:** 2026-10-12
- **Type:** feature
- **Scope:** `server`, `web`, `ui`
- **PR:** [#1047](https://github.com/Prism-Shadow/penguin-harness/pull/1047)

[中文版](2026-10-12-stat-breakdown-hints.zh.md)

The Trace view's split of elapsed time into model API time and tool wall time had disappeared: it lived in hover hints on readings whose text is fully visible, and the tooltip rule never opens a hint on such a reading. The breakdowns moved into a circled "?" to the right of the totals they break down, and cost gained a split by its three pricing buckets.

## Details

- The Trace overview's Elapsed and Cost rows each gained a circled "?" to the right of the value: Elapsed's lists model API time and tool wall time, Cost's lists cached input, uncached input and output, each followed by its share of the total (`$0.10 (3%)`).
- The Cost line of the chat page's details card gained the same "?", listing the three parts with their shares and, when some usage has no price, the uncosted note.
- The circled "?" panel (`InfoPopover`) is as wide as its content, up to 18rem. Panels placed by the shared portal hook (the "?" panel, menus, the context ring's panel) are now kept inside the window by the width they actually render at: `w-72` follows the theme's spacing unit, so in Frost (and at the larger text sizes) the "?" panel ran off the right edge and hid its text.
- Per-round readings and the chat header's chips kept their totals only; the hover breakdowns they carried, which never opened, were removed.
- The Trace analysis (`GET /api/sessions/:sessionId/traces/:index/analysis`, and the Agent-level route alike) gained the file's `costParts`, and each group row of `GET /api/projects/:projectId/usage` its own: `cacheRead`, `cacheWrite` and `output` in USD, priced exactly as `cost` is, so the three add up to it. A file or row with no priced usage carries none.
