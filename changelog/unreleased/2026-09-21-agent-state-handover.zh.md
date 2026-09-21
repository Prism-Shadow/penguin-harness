# 热更新不再打断运行中的任务

- **Date:** 2026-09-21
- **Type:** feature
- **Scope:** `server`, `core`
- **PR:** [#0000](https://github.com/Prism-Shadow/penguin-harness/pull/0000)

[English](2026-09-21-agent-state-handover.md)

热推送，以及每次插件变更触发的 App 重组，此前都会拒绝全部待审批并中止全部运行中的任务。现在改为
移交 Agent 状态：下一个 App 直接在上一个 App 的状态之上启动，任务继续。

## Details

- 离开的 App 把自己的 `AgentState` 节点登记到 HMR 注册表的 `agentState:state`，同时登记自己这份
  构建所声明的 `AgentState` 接口的闭包形状——接口本身连同它经接口表触及的一切，打印成一个规范化
  字符串（core kernel 新增的 `closedShape`）。
- 后继 App 打印出同一个字符串，就直接在这个对象之上启动。运行中的任务状态一直读作 `running`；
  热替换之后到来的审批、插话、中断与排队的 follow-up，由新 App 在同一份状态上处理。已经在途的
  任务用启动它的那份代码跑完；它结束时要启动的东西——下一个排队的 follow-up、后台完成通知——由
  届时的当前 App 启动。
- 后继 App 打印出不同的字符串，则销毁这一组：执行的是前一代自己的停止动作（拒绝审批、中止运行、
  销毁环境，即此前每次热替换都会做的事），随后后继 App 从 Trace 把当时有任务在途的 Session 逐个
  重新启动，附一条 `[harness_updated]` 说明；被打断的那一 turn 由 core 的 carry-over 带回。
- 后继 App 完全建好之前不停止任何东西，因此启动失败时回到的是一份没有被动过的状态。
- 进程退出不变：优雅排空照常执行。
- 插件变更重组的是同一份构建，所以总能接手状态。
- HMR 层与 runtime 没有改动：注册表、资源接口门与寄存上下文都是已有机制。推到早于本改动的 App
  之上时，第一次热替换的行为与从前相同；回滚到那样的 App 时，运行照旧被停止。
