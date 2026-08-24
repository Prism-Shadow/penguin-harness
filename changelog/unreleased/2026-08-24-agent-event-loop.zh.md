# Agent 循环倒转：热更新不再打断正在运行的任务

- **Date:** 2026-08-24
- **Type:** feat
- **Scope:** `core`, `server`
- **PR:** [#439](https://github.com/Prism-Shadow/penguin-harness/pull/439)

[English version](./2026-08-24-agent-event-loop.md)

过去平台热推送会硬停止所有正在运行的 agent 任务：LLM 流被中止、工具子进程被杀掉、待决
审批被收敛为拒绝。现在运行循环从引擎内部倒转出来，成为每会话一个的稳定事件循环，推送在
事件之间交换代码：正在运行的任务在下一个 turn 边界直接由新一代接手下一个 turn——
全程状态保持 `running`，没有被中止的 turn、没有重复执行的副作用，审批与中断始终有效。

## 详情

- 引擎内部遍历 turn 的 `for(;;)` 消失了：`beginRun` 把 turn 之间的续体具象为数据，
  `stepTurn` 恰好执行一个 turn（LLM 请求及其重连阶梯、工具、压缩检查点、下一输入装配）并
  回答 `continue`/`done`，`endRun` 在所有退出路径上收束运行。`Session.run` 保留为驱动这些
  步进的门面，Session 同时暴露同构的步进面（`beginRun`/`stepRun`/`endRun`），包裹图像折
  叠、bootstrap 和标题材料采集。有效输入为空的运行不再发出请求，直接结束。
- 每个会话的跨代状态——事件队列、运行状态、待决审批、中断控制器、显示镜像——归属一个
  `HmrAgent`（`runtime/hmr-agent.ts`）：一条队列、一个每次调用请当前一代把头部事件推进一
  个 turn 的 pump、一个由后继挂接并在调用之间交换的 `pending` 指针。follow-up 任务与后台
  通知投递统一为普通队列事件。`SessionManager` 不再持有任何 per-session 状态；它是门面加
  上该代的 `AgentImpl`（开一个运行、推进一个 turn、收束它）。
- agent 以单条共享 `hmr-agents:table` 条目骑乘资源注册表，并声明在平台的资源接口中：不兼
  容的后继会硬停整张表，回落到之前的中止行为。正在运行的任务是被**领养**而不是重启的——
  后继直接接手同一个运行的下一个 turn，因此换代不需要挂起、不需要重载、也不需要续段事件。
  只有 Session 对象仍属于创建它的那一代：换代时被标记为陈旧，于是**下一个**运行才通过后继
  的 loader 重新加载，与 vault 更新走同一套机制。
- 每消息管线（子 agent 注册与标题、bootstrap 暂存、live tail、发布、用量记录）迁出到
  `runtime/run-stream.ts`，goal 模式迁出到 `runtime/goal-run.ts`，于是 manager 回到循环之上
  的门面而不再是上帝对象：从 1963 行降到 1350 行。
- goal 运行和压缩暂无 turn 边界契约，保持硬中止语义，仍在排空宽限期内阻塞后继启动。跨越
  换代继续用旧代码的，恰好只有被领养运行自身的引擎，直到该运行结束；它的后台命令与 MCP
  连接随 Session 在重载时一起释放——与之前一致。
