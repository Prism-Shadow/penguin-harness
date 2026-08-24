# 子智能体支持运行中插话与逐轮停止——模型与面板同一通道

- **Date:** 2026-08-24
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`
- **Issue:** [#272](https://github.com/Prism-Shadow/penguin-harness/issues/272), [#274](https://github.com/Prism-Shadow/penguin-harness/issues/274)

[English](2026-08-24-subagent-steering.md)

此前子智能体是「发射后只能旁观」：`input_subagent` 对仍在运行的子会话直接拒绝 prompt，面板上更没有任何纠偏或停止子智能体的手段——停掉主智能体后子智能体依然在跑。这次用同一套机制补齐两侧：把用户对主会话已有的 steering 通道原样用到子会话上，模型与人都能触达。

## 模型侧（`input_subagent`）

- 子会话**运行中**发送的 `prompt` 现在作为 steering 插话注入——在子会话下一步以 `[user_steering]` 消息送达、写入子 Trace（sender 记为 `parent_agent`）、实时流到面板。原「still running」报错不再出现（仅对早于 steering 的第三方 SDK handle 保留）。
- 新增 `abort` 参数：只停止子会话**当前这一轮**，等价于用户按停止——会话保留、可继续插话或续跑，与 `kill_subagent` 的「终止并移除」相区分。与 `prompt` 同给时先等被中止的一轮收束、再以该 prompt 开新一轮：一次调用完成打断并改道。
- `run_subagent` / `input_subagent` 的工具描述同步教会模型这两种手势。内置默认变更照例前进配置内核版本（`2026-08-24`）；存量 Agent 的已存描述在内核更新或还原默认前保持不变，行为本身对所有会话立即生效。

## 用户侧（智能体面板）

- 选中子会话后，身份条新增**停止按钮**（运行中可见），嵌套对话下方新增**消息输入行**：运行中即插话，空闲即续跑一轮。两个新端点（`POST /api/sessions/:id/subagents/:childSessionId/steer|abort`）经父会话活跃运行时路由到 `input_subagent` 所用的同一 core 通道。
- 子会话自派生起即可触达——还在 `run_subagent` 前台窗口内的子会话同样可以插话与停止，不限于已转后台的。宿主路径首次触达还会挂上实时转发 tap，面板驱动的子会话不必等模型下次轮询即实时上屏。

## 子会话状态实况（issue #274）

面板此前靠解析工具输出文本（`still running` / `idle` 注记）推断子会话运行态，`input_subagent` 复活已结束的子会话后就会出现对勾冻结、耗时停走、「运行中 / 运行完毕」反复闪烁。运行态改为结构化实况：每轮启动与收束都上报宿主，服务端把全部存活子会话的 `{sessionId, running}` 并入 `task_state` 事件与 SSE 订阅快照，面板优先采用实况——文本启发只作为已死运行时、旧服务端与历史会话的回退。steering 送达消息还保留入队消息的 sender，子 Trace 由此记得是谁在插话。
