# 删除大 Agent 不再卡住应用，并显示进度

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `server`, `web`, `ui`, `docs`
- **PR:** [#1348](https://github.com/Prism-Shadow/penguin-harness/pull/1348)

[English](2026-10-26-agent-delete-background.md)

删除一个目录里文件很多的 Agent（比如临时 Workspace 里装了依赖）时，服务端要一直忙到最后一个文件删完：Web App 停在确认弹窗上，其他要读文件的页面也都排在这次删除后面。删到一半重启应用，Agents 列表里还留着这个 Agent，点进去或再删一次却提示「该 Agent 已不存在。」

## 细节

- 删除时先用一次 rename 把 Agent 目录移进 `agents/.deleting/`，删掉索引行，随即以 `202` 返回这次删除。从这一刻起，任何列表里都没有这个 Agent，所有路由都答 404，同一个 id 可以马上再用。目录里的内容在后台删除，同一时间只有少量文件系统调用在进行，服务端照常应答其他请求。
- `GET /api/projects/:projectId/agent-deletions/:deletionId` 报告删除进度：先是 `counting`，再是 `removing`（`total` 条中已删 `removed` 条），最后是 `done`，或 `failed` 并附操作系统给出的原因。
- 删除留下的东西，不论是删不掉的条目，还是服务端中途停止时剩下的部分，都会在下次启动时以同一个 deletion id 继续删除。
- 移动目录之前，服务端照旧中止该 Agent 的运行，现在还会释放它的 Workbench 目录监听、待执行的重载和已加载的 Workbench。如果目录仍因其他程序打开着其中的文件而移不走，删除以 `409 agent_folder_busy` 拒绝，什么都不删。
- Agents 列表只在 `agent_state/system_config.yaml` 存在时列出一个 Agent，与各 Agent 路由一直以来的判据相同，所以列出来的 Agent 总能打开、能删除。早先版本删到一半留下的 Agent 不再出现在列表里，目录里剩下的文件仍留在磁盘上。
- 删除耗时明显时，右下角出现一张卡片跟进：先统计条目，再显示已删条目数与总数，最后显示结果。关掉卡片不会中断删除，离开 Agents 页面后卡片也还在。这张卡片是 UI 包的 `ProgressToasts`，其他耗时操作也可以用。
