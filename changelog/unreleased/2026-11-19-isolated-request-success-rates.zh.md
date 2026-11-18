# 成本中心用点标出单个成功率

- **Date:** 2026-11-19
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1611](https://github.com/Prism-Shadow/penguin-harness/pull/1611)

[English](2026-11-19-isolated-request-success-rates.md)

按 Agent 或模型查看时，柱高对应左轴的请求数，成功率对应右轴的百分比。只有一个成功率时，图上会单独标出这个点，包括 0% 和 100%。缺少数据的时段会留空。点按图表可查看该时段的数据，也可以用 Tab 聚焦图表，再用方向键逐个查看。
