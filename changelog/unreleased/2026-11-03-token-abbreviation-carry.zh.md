# Token 数四舍五入到 1000 时进到下一个单位

- **Date:** 2026-11-03
- **Type:** fix
- **Scope:** `web`, `cli`
- **PR:** [#1448](https://github.com/Prism-Shadow/penguin-harness/pull/1448)

[English](2026-11-03-token-abbreviation-carry.md)

单位边界下方的 Token 数不再显示成四位数。Web App 和 CLI 原先按原始数值选单位，再保留一位小数，所以 999,950 个 Token 显示为 `1000k`，999,950,000 显示为 `1000M`。现在分别显示为 `1M` 和 `1B`。单位改为按四舍五入后的数值选择，和字节数的规则一致。
