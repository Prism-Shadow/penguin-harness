# 一个 Session 的 follow-up 队列最多保留 16 条

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `server`
- **PR:** [#853](https://github.com/Prism-Shadow/penguin-harness/pull/853)

[English](2026-10-10-follow-up-queue-cap.md)

带 `queueIfBusy` 的 `POST /api/sessions/:sessionId/tasks` 现在对第 17 条排队的 follow-up 以 `429 queue_full` 拒绝，而不是无上限入队；上限为每个 Session 的 `FOLLOW_UP_QUEUE_LIMIT`（16）。总是要求排队的路径——组织频道的 @提及或日程向繁忙工位的派发——把拒绝记为 `org_dispatch_failed` 后继续，因此一场提及风暴或一次 @all 扇出不再让工位队列无限增长、再把每一条都重放成一次模型调用。不带 `queueIfBusy` 时的 `409 task_in_progress` 不变；排出一条即空出一个位置。
