# `penguin cost` 保留低于千分之一美元的小额消费精度

- **Date:** 2026-11-22
- **Type:** fix
- **Scope:** `cli`, `server`
- **PR:** [#1692](https://github.com/Prism-Shadow/penguin-harness/pull/1692)

[English](2026-11-22-cli-cost-subcent.md)

`penguin cost` 与 `penguin cost --by <dimension>` 现在对低于 `$0.001` 的非零金额以四位有效数字显示（例如 `$0.0000123` 而非 `$0.0000`），与 Web 端成本中心保持一致，避免搜索、短语音或轻量对话产生的真实小额费用被舍入为零。零值、`$0.001` 及以上的金额、含未定价用量的 `+` 后缀以及无定价行保持原有显示。
