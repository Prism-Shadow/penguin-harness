# 热更新不再打断正在运行的 agent 任务

- **Date:** 2026-08-24
- **Type:** feat
- **Scope:** `core`, `server`
- **PR:** [#436](https://github.com/Prism-Shadow/penguin-harness/pull/436)

[English version](./2026-08-24-agent-run-handoff.md)

过去平台热推送会硬停止所有正在运行的 agent 任务：LLM 流被中止、工具子进程被杀掉、待决审批
被收敛为拒绝。现在正在运行的任务可以跨越 swap 存活：驱动循环继续跑到下一个 turn 边界并在
那里静默停车，后继 App 从 Trace 恢复该任务——对话从停车处继续，没有被中止的 turn，也没有
重复执行的副作用。整个过程中待决审批始终可以回应，中断始终有效。

## 详情

- 每个会话的运行状态现在归属一个 per-session **管程**（`runtime/session-monitor.ts`）：
  状态、待决审批、中断控制器、排队的 follow-up 和显示镜像，所有操作在管程边界串行化。
  `SessionManager` 不再持有任何 per-session 状态——它是门面，也是管程委托的当代过程集。
- 管程以单张共享表（`agent-sessions:table`）骑乘资源注册表跨越 swap，并声明在平台的资源
  接口里：不兼容的后继会硬停整张表，回落到之前的中止行为。后继的 manager 在构造时挂接到
  每个管程；管程在事件边界交换代码指针——空闲立即换、忙碌在运行结算时换——下一个事件
  （排队的 follow-up，或停车运行的续段）由新一代处理。已加载的 Session 对象属于代码侧，
  跨边界时从 Trace 重新加载。
- 引擎新增 turn 边界停车请求（`RunOptions.shouldPark`）：在每个 turn 的 LLM 请求发出前
  询问一次，停车把待发送的 turn 输入作为 carry-over 保留——与 max-turns 停止同一机制——
  然后不发出任何消息地结束生成器。Trace 回放的按位置 carry-over 重建在下一代产生同样的
  输入。有效输入为空的运行现在直接结束，不再发出请求。
- swap 路径上 `SessionManager.quiesce()` 取代了 `shutdown()`：正在运行的任务被请求停车
  而不是被中止。goal 运行和压缩没有可停车的边界契约，保持硬中止语义，仍在排空宽限期内
  阻塞后继的启动。
- 陪跑窗口是当前 turn 及其全部工具调用（`run_subagent` 调用会把窗口拉长到子 agent 完成
  为止）。旧一代的会话环境在指针交换时被销毁，因此对话启动的后台命令不会跨越它——与
  之前一致。
