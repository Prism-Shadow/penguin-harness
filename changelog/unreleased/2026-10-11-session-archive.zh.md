# 侧栏只列活跃对话，已归档对话移入设置

- **Date:** 2026-10-11
- **Type:** feature
- **Scope:** `server`, `web`, `cli`, `docs`
- **PR:** [#1032](https://github.com/Prism-Shadow/penguin-harness/pull/1032)

[English](2026-10-11-session-archive.md)

侧栏的「后台会话」与「已归档」折叠夹已移除。用户归档的 Session，以及由程序开启（Agent API、定时任务的新会话运行、`penguin run`）且用户未保留的 Session，算作已归档；其余对话都是活跃对话，列在侧栏。已归档对话移到设置中新增的「已归档对话」页面，可以搜索、筛选，并批量取消归档或删除。子 Agent 会话只能从父会话的 Agent 面板打开。

## 细节

- **Server**：列出规则在每次读取时计算。`sessions` 表新增可空列 `kept_at`（schema 迁移 15）：取消归档时写入，归档时清除，运行从不改写，因此用户取消归档的后台会话在之后的运行中仍留在侧栏。`SessionInfo.archived` 即该规则的结果。从这个版本起，已有的 api、schedule、cli 会话按已归档列出；磁盘上的数据不做改写。
- **Server**：`SessionCategory` 只有 `active` 与 `archived`；`?category=background` 返回 400。`subagent` 与 `company` 会话不属于任何类别，也不计入任何总数，在会话列表和分页的 Agent Traces 列表中都是如此。
- **Server**：`PATCH /api/sessions/:id {archived}` 对 `subagent` 或 `company` 会话返回 `409 session_not_listed`，并向 Project 的用户发出 `session_archived`。`DELETE /api/sessions/:id` 会一并删除该会话自己派生的子 Agent 会话（从其 Trace 中的 `subagent` 指针记录找到；分叉随复制的历史带来的指针所指的子会话属于源会话，不随分叉删除），并为删除的每个会话发出 `session_deleted`。
- **Server**：新增四个当前用户下的路由：`GET /api/me/archived-sessions/groups`（按 Project 下的 Workspace 分组并给出数量）、`GET /api/me/archived-sessions`（单个分组的会话，按最近活跃倒序、游标分页）、`POST /api/me/archived-sessions/unarchive` 与 `POST /api/me/archived-sessions/delete`（按 id 指定，最多 500 个，或按筛选条件）。范围是用户拥有或参与的所有 Project，可按标题搜索、按来源（`user`、`api`、`schedule`、`cli`）筛选。
- **Web**：侧栏只获取活跃会话，Workspace 分组只按活跃数量形成；「仅有折叠任务」的分组随之移除。用户保留的程序会话带有来源图标。行菜单保留「归档」。
- **Web**：「设置 › 个人 › 已归档对话」按 Project 下的 Workspace 分组列出已归档对话，最新的分组在前，每组显示数量，并有菜单可整组取消归档或删除。每行显示标题、时间、来源和运行标记，带删除图标与「取消归档」按钮；可多选后批量操作。所有删除操作都会先确认。页面会即时反映别处的改动。
- **Web**：打开已归档对话的链接时，不显示对话内容，而是显示一个占位页：标题、时间、来源、「取消归档」按钮和删除图标；取消归档后在原处加载对话。
- **Web**：只有侧栏中的对话才发出完成通知（已归档、子 Agent 与公司模式的会话都不发）；程序开启会话时侧栏不再重新加载。
- **CLI**：`penguin session ls` 默认不列出 `penguin run` 创建的会话（它们按规则已归档）；加 `-a` 可列出。
- **Docs**：对话、设置、Server API、Agent API、CLI、评估中心与自我改进页面加入了已归档对话的说明。

这个版本之前由程序开启的会话列在「已归档对话」页面；取消归档后，它会一直留在侧栏。
