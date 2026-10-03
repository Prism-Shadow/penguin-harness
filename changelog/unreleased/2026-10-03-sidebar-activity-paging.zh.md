# 侧栏列表按最后活动分页，只在底部追加

- **Date:** 2026-10-03
- **Type:** fix
- **Scope:** `web`, `server`, `ui-gallery`

[English](2026-10-03-sidebar-activity-paging.md)

侧栏按时间分组时，点击「加载更多会话」不再把行从「更早」跳进「近一天」。此前列表按最后活动显示、却按创建时间分页，且每个 Agent 各自分页，后一页的行可能本应排在已显示的行之上。侧栏的每个列表改为按显示顺序分页，由多条流合并的列表只显示各流都已覆盖的部分。同一修正也用于按 Agent、按 Workspace 分组，以及子智能体 / 定时任务 / 评估任务 / 已归档子夹。

## 细节

- `GET /api/projects/:projectId/agents/:agentId/sessions` 新增 `order=activity`（按 `lastActiveAt` 降序，相同时按 `sessionId` 降序，均按码点比较）与 `before=<lastActiveAt>,<sessionId>`（返回严格位于该键之后的行）。`before` 须配合 `order=activity` 与 `limit`，不能与 `offset` 同用；格式不对返回 400。不带 `order` 时仍按创建时间排序、用 offset 分页，`counts=1` 的计数仍覆盖整个列表。
- Web App 的侧栏请求一律带 `order=activity`，每次「更多」都从已显示的最后一行的键接着取。Workspace 分组沿本组流取首页时，从该 Agent 在同一机器上的游标接着取；该 Agent 的列表已取完时不再发请求。
- 侧栏绘制的每个列表——按时间分组（在分桶之前）、每个 Agent 与 Workspace 分组、每个子夹——都在其水位线处截断：水位线取仍有剩余的各条流（Agent、机器）中最新的游标。水位线以下的行留在内存，待之后的页把水位线降下来再显示，因此「展开其余 N 个对话」与「加载更多会话」只在已显示的行之下追加。当前打开的对话始终显示，搜索仍覆盖所有已加载的行。子夹改为按最后活动排序，不再按创建时间。
- 用户频道的 `session_state` 事件新增 `projectId`。列表中没有的当前 Project 的 Session 开始运行时，从发出事件的机器取回这一行一次、显示在顶部，并套用最新的状态；同一次运行的多次状态切换共用一次查询，组织的会话以及已删除、已不存在的 Session 不会被再次查询。
- 画廊的模拟列表接口同样支持 `order` 与 `before`。
