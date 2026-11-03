# Token counts that round up to 1000 carry into the next unit

- **Date:** 2026-11-03
- **Type:** fix
- **Scope:** `web`, `cli`
- **PR:** [#1448](https://github.com/Prism-Shadow/penguin-harness/pull/1448)

[中文版](2026-11-03-token-abbreviation-carry.zh.md)

A token count just below a unit boundary no longer prints a four-digit figure. The Web App and the CLI picked the unit from the raw count and then rounded it to one decimal, so 999,950 tokens read `1000k` and 999,950,000 read `1000M`. They now read `1M` and `1B`. The unit is chosen from the rounded value, the same rule byte counts already follow.
