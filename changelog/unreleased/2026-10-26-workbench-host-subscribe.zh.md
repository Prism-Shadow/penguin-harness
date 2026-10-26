# Workbench 的处理器可以实时跟随 Session

- **Date:** 2026-10-26
- **Type:** feature
- **Scope:** `server`
- **PR:** [#1349](https://github.com/Prism-Shadow/penguin-harness/pull/1349)

[English](2026-10-26-workbench-host-subscribe.md)

`WorkbenchHost` 新增 `subscribe(sessionId, listener)`，返回取消订阅的函数。Workbench 的处理器从订阅那一刻起，就能收到本 Project 中某个 Session 发布的每条记录，与 `GET /api/sessions/:id/amsp` 流出的记录相同，不必再靠轮询 `sessionResult` 才知道任务已经结束。

## 细节

- listener 收到的是 AMSP 记录信封，类型为 `WorkbenchRecord`（`timestamp`、`type`、`payload` 和可选的 `origin`）。增量片段和子 Agent 的记录都在其中，Web App 的服务端事件不在。不回放此前的记录。
- 订阅本 Project 之外的 Session 会被拒绝，报错与其他 host 调用一致。
- listener 在记录发布之后运行，从不在 Session 的运行循环里执行。抛错的 listener 每个订阅只记一次日志，之后照常收到记录。
- 主 Session 的 `task_end`（不带 `origin`）先于 Session 转为 idle 到达，在此之前 `sessionResult` 仍返回 `running`。
- 重复调用取消订阅函数不会产生任何效果。Workbench 重新加载或被移除时，它的订阅全部结束；Session 空闲且 30 分钟内没有任何发布的订阅也会自行结束，处理器忘了取消的订阅因此不会无限期占住该 Session 的流缓冲。
- `sessionResult`、`sessionStatus` 和轮询都保持不变。
- 服务端写入每个 Workbench 的 `.harness/README.md` 加入了 `subscribe` 的说明。本次改动之前编写的 Workbench 照常加载；它的 `.harness/plugin.d.ts` 里没有 `subscribe`，删除 `.harness/` 之后才会有。
