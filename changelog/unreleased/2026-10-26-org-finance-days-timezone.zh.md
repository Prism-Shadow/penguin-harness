# 组织财务趋势按组织时区划分日期

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `server`
- **Issue:** [#738](https://github.com/Prism-Shadow/penguin-harness/issues/738)

[English](2026-10-26-org-finance-days-timezone.md)

修复了公司财务页的每日成本图按服务器时区标注日期、而图表覆盖的月份却按组织时区划分的问题。午夜前后的花费会落到相邻的柱上，第一根或最后一根柱还可能落在该月之外：在 UTC 主机上运行的 `Asia/Shanghai` 组织，九月的图表以 8 月 31 日的柱开头。现在每个请求按其实际发生的时刻归入组织时区的日历日，月内的夏令时切换也会随之移动日界。当月总额和各员工的花费原本就正确，没有变化。
