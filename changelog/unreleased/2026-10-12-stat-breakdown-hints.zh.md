# 统计分项收进总计右侧的圆圈「?」；成本按计价桶拆分

- **Date:** 2026-10-12
- **Type:** feature
- **Scope:** `server`, `web`

[English](2026-10-12-stat-breakdown-hints.md)

轨迹面板里用时的两个分项（模型 API 时间与工具 wall time）不见了：它们写在读数的悬停提示里，而这些读数的文字完整可见，按悬停提示的规则永远不会弹出。分项改放进所拆解的总计右侧的圆圈「?」里，成本也新增了按三个计价桶的拆分。

## 细节

- 轨迹面板全局统计的「用时」「成本」两行各在数值右侧加了一枚圆圈「?」：用时的列出模型 API 时间与工具 wall time，成本的列出缓存输入、未缓存输入与输出。
- 对话页详情卡的「成本」条目加了同样的「?」，列出三分项；有未定价用量时附未定价说明。
- 逐轮读数与对话页顶部的统计芯片只保留总数；它们原先带的、从不会弹出的悬停分项已删除。
- Trace 分析（`GET /api/sessions/:sessionId/traces/:index/analysis`，Agent 级路由同样）新增整份文件的 `costParts`，`GET /api/projects/:projectId/usage` 的每个分组行也带上自己的一份：`cacheRead`、`cacheWrite`、`output`，单位 USD，计价与 `cost` 完全一致，三项之和即 `cost`。没有已定价用量的文件或分组行不带此字段。
