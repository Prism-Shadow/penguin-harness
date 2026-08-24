# Agent 循环倒转：热更新不再打断正在运行的任务

- **Date:** 2026-08-24
- **Type:** feat
- **Scope:** `core`, `server`
- **PR:** [#439](https://github.com/Prism-Shadow/penguin-harness/pull/439)

[English version](./2026-08-24-agent-event-loop.md)

过去平台热推送会硬停止所有正在运行的 agent 任务：LLM 流被中止、工具子进程被杀掉、待决
审批被收敛为拒绝。现在运行循环从引擎内部倒转出来，成为每会话一个的稳定事件循环，推送在
事件之间交换代码：正在运行的任务在下一个 turn 边界被挂起，由新一代从 Trace 接续完成——
全程状态保持 `running`，没有被中止的 turn、没有重复执行的副作用，审批与中断始终有效。

## 详情

- 引擎内部遍历 turn 的 `for(;;)` 消失了：`beginRun` 把 turn 之间的续体具象为数据，
  `stepTurn` 恰好执行一个 turn（LLM 请求及其重连阶梯、工具、压缩检查点、下一输入装配）并
  回答 `continue`/`done`，`endRun` 在所有退出路径上收束运行。`Session.run` 保留为驱动这些
  步进的门面，Session 同时暴露同构的步进面（`beginRun`/`stepRun`/`endRun`），包裹图像折
  叠、bootstrap 和标题材料采集。有效输入为空的运行不再发出请求，直接结束。
- 每个会话的跨代状态——事件队列、运行状态、待决审批、中断控制器、显示镜像——归属一个
  `HmrAgent`（`runtime/hmr-agent.ts`）：一条队列、一个每次调用请当前一代把头部事件推进一
  个 turn 的 pump、一个由后继挂接并在调用之间交换的 `pending` 指针。follow-up 任务、被挂
  起运行的剩余部分、后台通知投递统一为队列事件。`SessionManager` 不再持有任何 per-session
  状态；它是门面加上该代的 `AgentImpl`（open/step/suspend/finish）。
- agent 以单条共享 `hmr-agents:table` 条目骑乘资源注册表，并声明在平台的资源接口中：不兼
  容的后继会硬停整张表，回落到之前的中止行为。运行永不跨代——换代边界上旧一代优雅收束
  （Trace 承载续体，重载时按位置重建），后继的 loader 重新加载会话。
- 中断永远胜过换代：中止信号已点火的运行绝不会被挂起再续；落在挂起与续段之间的中断会取
  消重新启动。
- goal 运行和压缩暂无 turn 边界契约，保持硬中止语义，仍在排空宽限期内阻塞后继启动。挂起
  窗口为当前 turn 及其全部工具调用（`run_subagent` 会拉长它）；旧一代的会话环境在换代时
  被销毁，因此对话启动的后台命令不会跨越它——与之前一致。
