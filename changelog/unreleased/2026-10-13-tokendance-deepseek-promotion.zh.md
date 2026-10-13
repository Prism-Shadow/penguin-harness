# TokenDance：DeepSeek V4.1 Flash 带上卖家的 8 折促销

- **Date:** 2026-10-13
- **Type:** fix
- **Scope:** `model-catalog`, `docs`
- **PR:** [#1087](https://github.com/Prism-Shadow/penguin-harness/pull/1087)

[English](2026-10-13-tokendance-deepseek-promotion.md)

**同步新增模型**和新建 Project 现在会给 TokenDance 的 `deepseek-v4.1-flash` 带上 TokenDance 在 DeepSeek 高峰 / 空闲时段规则之外另打的 8 折。卡片在任何时段都显示优惠，成本中心按 TokenDance 实收计费。Project 里已有的模型不会被改动，要让它们带上目录的促销，仍然用**恢复默认**。

## 细节

- 目录条目可以在空闲时段规则旁边并列声明促销，两者相乘，与 Project 条目上存的促销遇到时段规则时的算法一致。
- TokenDance 的 `deepseek-v4.1-flash` 声明 8 折：高峰时段按人民币 1.6 / 6.4 / 0.032（输入 / 输出 / 缓存命中）计费，空闲时段按 0.8 / 3.2 / 0.016。
- `deepseek-v4-flash-0731` 和 `deepseek-v4-pro-0813` 的 8 折只在高峰时段生效，与时段规则并列的促销表达不了，它们的高峰时段仍按牌价计费。
