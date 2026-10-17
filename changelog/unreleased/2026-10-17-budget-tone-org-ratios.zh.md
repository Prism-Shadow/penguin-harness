# 预算仪表跟随组织的警告与暂停比例

- **Date:** 2026-10-17
- **Type:** fix
- **Scope:** `web`
- **Issue:** [#737](https://github.com/Prism-Shadow/penguin-harness/issues/737)

[English](2026-10-17-budget-tone-org-ratios.md)

公司模式的预算仪表不再总是在 80% 变黄、100% 变红。总览页的圆环和进度条使用组织配置的 `budget_warn_ratio` / `budget_pause_ratio`；财务页按服务端已经按这些比例算好的 `warned` / `paused` 着色。

## 细节

- `budgetTone` 接受可选的警告与暂停阈值，缺省仍为 0.8 / 1.0。
- 总览页的支出 KPI 传入该组织的设置。
- 财务页员工仪表和 KPI 圆环跟随 `warned` / `paused`，因此 50% 就已暂停的员工不会仍被画成健康。
