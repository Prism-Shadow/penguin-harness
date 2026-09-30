# 遥测采集点：每个 turn、每个 session、插件加载与热更新

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `server`, `cli`
- **PR:** [Myriad-Dreamin/penguin-harness#119](https://github.com/Myriad-Dreamin/penguin-harness/pull/119)

[English](2026-09-30-telemetry-probes.md)

第一片的遥测开关现在也覆盖一个 turn 的服务端各段、session 列表、插件加载与热更新，读口多一个整机视图（PRFC-0008）。样本照旧只记形状，开关关着时每个采集点只是一次布尔判断。

- 一个 turn：`task.accept`（接受 Task，含等锁）、`session.ensure`（加载、重建或复用运行时 Session，带恢复出的历史条数），每次 run 一条 `turn.run`，含模型所占的时间（`modelMs`，从每个 `request_begin` 到对应的 `request_end`），以及按 run 汇总逐条消息工作的 `turn.tail`、`turn.fanout`、`turn.errors`、`turn.usage`。`turn.badge` 记每次状态广播的用时。一次 run 的样本带 session、task id 与发起它的请求。
- session 列表：`sessions.list.sql`、`sessions.list.reconcile`、`sessions.list.rows`；`trace.reconcile` 由真正跑了 reconcile 的那次调用记为 `led`，搭上进行中那一次的调用记为 `shared`。
- 插件加载（平台那一次，按插件、按步）：`plugin.load`，步为 `activate`、`import`、`table`、`check`、`host` 或 `reused`。
- 热更新的平台侧：旧 App 的 `hmr.park` 与 `hmr.dispose`（由下一代记下）、准入探测的 `hmr.admit`，以及每次 create 一条 `hmr.generation`，带来历（`boot`、`push`、`reassemble`）与本进程 create 同一个平台包的次数。每次 create 之后另记一条 `process.memory`。

`GET /api/telemetry?view=machine` 给出本进程的内存、App 代数，以及每个已加载 Session 占着什么（恢复的历史、通道缓冲、订阅数、live tail、排队的 follow-up）；`penguin telemetry --by machine` 打印这一视图。
