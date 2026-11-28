
# 修复公司预算指标未遵循配置阈值的问题

- **Date:** 2026-10-27
- **Type:** fix
- **Scope:** `server`, `web`
- **PR:** [#1372](https://github.com/Prism-Shadow/penguin-harness/pull/1372)
- **Issue:** [#737](https://github.com/Prism-Shadow/penguin-harness/issues/737)

[English](2026-10-27-company-budget-thresholds.md)

修复了公司概览、财务页面和组织结构图中的预算指标，使其按照组织配置的预警和暂停阈值显示状态，而不再依赖固定的百分比边界。