# 模型可以把思考与其余输出分开计价

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `db`, `docs`
- **PR:** [#1615](https://github.com/Prism-Shadow/penguin-harness/pull/1615)

[English](./2026-11-19-thinking-price.md)

`.project_config.toml` 中模型的 `pricing` 在 `cache_read`、`cache_write`、`output` 之外新增可选的 `thoughts`（思考价格），单位同为每百万 Token 的美元价格。未设置时思考仍按输出计价，与此前相同。

- 插件经 `ProjectModelRequests` 发出的请求，会把 MMSP 报告的思考 Token 记入 `usage_records` 新增的可空列 `thoughts`；这部分 Token 仍包含在 `output` 中。
- 模型设有思考价格时，成本中心、Session 成本与公司模式预算按该价格计算这部分思考 Token，其余输出按 `output` 计价。对话轮次不单独报告思考，其输出仍全部按 `output` 计价。
- 预置的 Gemini Omni 1.2 Flash 的思考按每百万 Token 9 美元计价，不再沿用 12 美元的视频输出价格。
- `PUT /api/projects/:projectId/models` 接受并返回 `pricing.thoughts`。与这次整表写入的其他字段一样，省略即删除。模型页保存时保留已存的思考价格。机器同步会带上它，旧版本的机器忽略这一项。
