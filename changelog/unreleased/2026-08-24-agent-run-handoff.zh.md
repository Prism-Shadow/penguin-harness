# 热更新不再打断正在运行的 agent 任务

- **Date:** 2026-08-24
- **Type:** feat
- **Scope:** `core`, `server`
- **PR:** [#436](https://github.com/Prism-Shadow/penguin-harness/pull/436)

[English version](./2026-08-24-agent-run-handoff.md)

过去平台热推送会硬停止所有正在运行的 agent 任务：LLM 流被中止、工具子进程被杀掉、待决审批
被收敛为拒绝。现在正在运行的任务可以跨越 swap 存活：旧一代的驱动循环继续跑到下一个 turn
边界并在那里静默停车，后继 App 从 Trace 恢复该任务——对话从停车处继续，没有被中止的
turn，也没有重复执行的副作用。

## 详情

- 引擎新增 turn 边界停车请求（`RunOptions.shouldPark`）：在每个 turn 的 LLM 请求发出前
  询问一次，停车会把待发送的 turn 输入作为 carry-over 保留——与 max-turns 停止使用同一
  机制——然后不发出任何消息地结束生成器。进程内恢复走引擎自己的 carry-over；跨代恢复由
  Trace 回放的按位置 carry-over 重建产生同样的输入。有效输入为空的运行现在直接结束，
  不再发出请求。
- swap 路径上 `SessionManager.quiesce()` 取代了 `shutdown()`：正在运行的任务被请求停车
  而不是被中止，每个任务作为一个 `RunHandoff` 交给后继——状态读作忙碌，审批决定和中断
  转发到旧一代的注册表，旧驱动尘埃落定之前不允许在同一 Trace 上加载第二个写者。goal
  运行和压缩没有可停车的边界契约，保持硬中止语义，仍在排空宽限期内阻塞后继的启动。
- 句柄以单个 `agent-runs:handoff` 条目骑乘资源注册表，并声明在平台的资源接口里：不兼容
  的后继会硬停该组，回落到之前的中止行为；进程退出清扫会停掉始终没有等到收养者的
  lame duck。
- 陪跑窗口是当前 turn 及其全部工具调用（`run_subagent` 调用会把窗口拉长到子 agent 完成
  为止）。旧一代的会话环境仍在其驱动尘埃落定后被销毁，因此对话启动的后台命令不会跨越
  swap 存活——与之前一致。
