# 结束的定时任务移入 `schedule/expired/`

- **Date:** 2026-10-15
- **Type:** feature
- **Scope:** `server`, `web`, `cli`, `docs`, `skills`
- **PR:** [#1159](https://github.com/Prism-Shadow/penguin-harness/pull/1159)

[English](2026-10-15-schedule-expired-dir.md)

调度器现在会归档不会再触发的定时任务：已触发的一次性任务（`done`）、在服务器停机期间错过时间的一次性任务（`missed`），以及已过 `end_at` 的任务（`expired`）。这类任务的文件被原样移入该 Agent 的 `agent_state/schedule/expired/`，其 SQLite 运行状态也像文件被删除一样清除。

## 细节

- 对账与定时任务列表都会执行归档。一次性任务在触发后、发出 `schedule_fired` 之前即被移走，因此这一事件触发的重新拉取不会再列出它。仍有排队待发的触发时，任务等这次触发发出后再移走。
- 归档的任务不再出现在任何列表和计数中：Agent 的定时任务标签页及其卡片的 `scheduleCount`、对话页停靠栏的定时任务面板、侧栏的闹钟标记、schedules API、`penguin schedule ls`，以及自下一个模型上下文起 Agent 的 `{{SCHEDULE_LIST}}` 任务清单。
- `expired/` 里已有同名文件时，移入的文件加上 UTC 时间戳后缀（`<name>.20261015T093000Z.toml`，再冲突则为 `-2`、`-3`…），不覆盖任何文件。移动失败时记录 `schedule_archive_failed`，任务继续留在列表中，直到后续一轮把它移走。
- 无效（绑定的 Session 已删除）与已停用的任务不归档。
- 把文件移回 `schedule/` 即作为新任务登记；时间仍已过去的会再次归档。
- 磁盘上已有的过时任务在升级后的首次对账中按同一规则移走。
- schedules API 的 `POST` 与 `PUT` 对 `startAt` 已过的一次性任务、以及 `endAt` 已过的任务返回 400。CLI 与 Web 表单随之同样拒绝，因此 `penguin schedule add --start-at now` 现在须带 `--period`。
- 定时任务面板去掉了**已完成**筛选，保留**全部**、**生效中**和**已暂停**。
- 定时任务、智能体、CLI、配置与服务器 API 文档，CLI 帮助、「用 AI 创建」的提示词以及 `penguin-orchestration` Skill 写明了归档行为与新的拒绝规则。
