# `penguin cost` keeps small charges readable below a tenth of a cent

- **Date:** 2026-11-22
- **Type:** fix
- **Scope:** `cli`, `server`
- **PR:** [#1692](https://github.com/Prism-Shadow/penguin-harness/pull/1692)

[中文版](2026-11-22-cli-cost-subcent.zh.md)

`penguin cost` and `penguin cost --by <dimension>` now display non-zero amounts below `$0.001` with four significant digits (such as `$0.0000123` instead of `$0.0000`), matching the Web App's Cost Center so small charges from searches, short audio requests, or lightweight chat turns are not rounded down to zero. Zero, amounts from `$0.001` up, the `+` suffix for unpriced usage, and unpriced rows keep their previous display.
