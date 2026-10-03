# 遥测采集点：每个 turn、每个 session、插件加载与热更新

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `server`, `cli`
- **PR:** [Myriad-Dreamin/penguin-harness#119](https://github.com/Myriad-Dreamin/penguin-harness/pull/119)

[English](2026-09-30-telemetry-probes.md)

第一片的遥测开关现在也覆盖一个 turn 的服务端各段、session 列表、插件加载、热更新，以及进程与每个已加载 Session 的内存（PRFC-0008）。样本照旧只记形状——每个属性以它是什么命名（`messages`、`rows`、`memoryCost`）——开关关着时每个采集点只是一次布尔判断。

- 一个 turn：`task.accept`（接受 Task，含等锁）、`session.load`（载入不在内存里的 Session，带恢复出的历史条数），每次 run 一条 `turn.run`，含模型所占的时间（`modelMs`，从每个 `request_begin` 到对应的 `request_end`），以及按 run 汇总逐条消息工作的 `turn.tail`、`turn.fanout`、`turn.errors`、`turn.usage`。`turn.badge` 记每次状态广播的用时。一次 run 的样本带 session、task id 与发起它的请求。
- session 列表：`sessions.list.sql` 与 `sessions.list.reconcile`；`trace.reconcile` 每一遍只记一条，不论有几个调用搭上它。
- 插件加载：平台导入并检查的每个插件记一条 `plugin.load`。
- 热更新的平台侧：旧 App 的 `hmr.park` 与 `hmr.dispose`（由下一代记下）、准入探测的 `hmr.admit`，以及每次 create 一条 `hmr.generation`（启动与热更新的计时都在 `telemetry/boot.ts`，平台的启动代码只是一行行调用它），带来历（`boot`、`push`、`reassemble`）。

- 内存：读缓冲时，`process.memory` 记下进程的、`session.memory` 记下每个已加载 Session 的 `memoryCost`——它在内存里占的字节：恢复的历史、为重连的页面留着的流事件，以及还在流式输出的回复。每次 create 之后也记一条 `process.memory`。
