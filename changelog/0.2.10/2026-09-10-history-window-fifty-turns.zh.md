# 对话打开只加载最近 50 轮，不再一次载入整段历史

- **Date:** 2026-09-10
- **Type:** fix
- **Scope:** `web`, `docs`
- **PR:** [#665](https://github.com/Prism-Shadow/penguin-harness/pull/665)

[English](2026-09-10-history-window-fifty-turns.md)

Web App 打开一个对话现在只拉取最近 50 轮，滚动到顶部附近时每次再向前续载 50 轮。历史窗口机制早已存在，但尾窗取 200 个 Task，几乎所有真实 Session 都装得下，于是每次打开仍然把整段历史（含工具输出）读完、传完、渲染完；长时间的 Agent 会话要花好几秒打开一堆没人在看的内容。

## 细节

- 初始历史窗口为 50 个 Task（原 200），每次向上滚动续载 50 个（原 100）。窗口机制不变：按 Task 边界切分、插入时保持阅读位置、到达开头的标记、失败后的点击重试，以及由服务端随窗口附带的累计值接续轮次编号与顶部统计，使窗口加载与整段加载一致。
- 服务端 API 文档补充 `GET /api/sessions/:sessionId/messages` 的 `tailLimit` / `before`+`limit` 窗口形式与 `page` 字段；Web App 文档说明 50 轮窗口。
