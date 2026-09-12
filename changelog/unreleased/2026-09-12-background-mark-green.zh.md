# 后台任务标记与其计数改回绿色

- **Date:** 2026-09-12
- **Type:** fix
- **Scope:** `web`
- **PR:** [#713](https://github.com/Prism-Shadow/penguin-harness/pull/713)

[English](2026-09-12-background-mark-green.md)

标记会话仍有后台任务的活动波形，以及对话页头统计旁的后台任务计数，改回运行态同款的绿色（应用用来表示正在进行的工作的颜色）——此前一次改动把它们和定时任务标记一起调成了灰色。

## 细节

- `BackgroundTasksMark`（会话行与工具行的后台调用标记）使用 `busy` 墨色。
- 对话页头的后台任务计数用同一墨色，图标与数字在各处颜色一致；悬停提示仍以文字说明数量。
- 定时任务标记保持灰色不变。
