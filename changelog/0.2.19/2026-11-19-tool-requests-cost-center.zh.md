# 成本中心把工具请求与对话 Token 分开列出

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `server`, `web`, `ui-gallery`, `docs`
- **PR:** [#1616](https://github.com/Prism-Shadow/penguin-harness/pull/1616)

[English](2026-11-19-tool-requests-cost-center.md)

工具请求是插件经 `ProjectModelRequests` 为其工具发出的请求，例如生成图片、转写语音或搜索网页。它们在 `usage_records` 中的行带有 `purpose`，成本中心只读这一份用量记录。工具请求的思考 Token 计入输出，与对话轮次一样按模型的输出价格计费，不单设思考价格。

- 汇总卡片的 Token 与 Token 趋势只计对话轮次。工具请求的 Token 是 MMSP 的计费单位（一次搜索记为 1,000），不计入这些数字。
- 请求数、成本、请求图、成功率与成本趋势包含工具请求。汇总卡片新增「其中工具请求」一行，写明它们的次数与成本；图表下方新增「工具请求」卡片，按用途列出次数与成本。区间内有工具请求时才显示这一行与这张卡片。
- 没有 Session 的工具请求只计入 Project 合计，不进入按 Agent 与按 Session 的分组、按 Agent 的请求图和 Agent 筛选列表。
- `GET /api/projects/:projectId/usage` 的每个汇总桶新增 `toolRequests` 与 `toolCost`，并新增 `tools` 列表，每种用途一行（`purpose`、`requests`、`cost`、`hasUncosted`）。模型页的累计用量把同一模型的对话行与工具行合为一项。
- 两个供应商以同一名称出售某个模型时，模型筛选与按模型的请求图会在名称旁注明供应商。
- 不足千分之一美元的成本显示四位有效数字，不再舍入为 `$0.0000`。
- 中文界面的成本中心在汇总卡片与工具请求表中把请求数标为「请求数」，此前显示的是英文单词。
