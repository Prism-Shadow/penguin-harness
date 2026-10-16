# 组织财务趋势使用组织时区

- **Date:** 2026-10-16
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1178](https://github.com/Prism-Shadow/penguin-harness/pull/1178)
- **Issue:** [#738](https://github.com/Prism-Shadow/penguin-harness/issues/738)

[English](2026-10-16-organization-finance-timezone.md)

组织财务趋势按组织时区的自然日汇总支出，与月度预算窗口使用的时区保持一致。

## 每日支出

- 午夜附近的用量归入正确的当地日期，包括月初和月末。
- 日期边界遵循夏令时切换和非整小时 UTC 偏移。
- 成本中心图表保留服务器本地日期，计价时段和月度总额保持不变。
