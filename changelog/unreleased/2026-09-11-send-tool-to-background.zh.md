# 运行中的工具调用可以从卡片上转为后台任务

- **Date:** 2026-09-11
- **Type:** feature
- **Scope:** `core`, `server`, `web`
- **PR:** [#691](https://github.com/Prism-Shadow/penguin-harness/pull/691)

[English](2026-09-11-send-tool-to-background.md)

`exec_command` 与 `run_subagent` 正在执行时，对话里的工具调用行新增一个「转入后台执行」动作，点击即把这
次调用的工作交还为后台任务：调用带着 `process_id` / `subagent_id` 正常结束，进程不会被杀掉，主对话不必等
命令跑完就继续进行。任务完成后仍以一贯的后台任务通知送回，与 `run_in_background` 启动的任务一致；转入后台的进程
也会出现在 Session 的进程列表里，带有原有的停止与移除操作。

## 细节

- 核心为每个执行中的工具调用单独提供一条 detach 通道，与本次运行的中断信号相互独立，由
  `Session.detachToolCall(toolCallId)` 触发。转为后台不是中断：调用以 `completed` 结束、带回句柄、不附
  中断标记；只有具备后台形态的这两个工具会响应它，其余工具行为完全不变。
- 转为后台的 `run_subagent` 子会话会继承本次调用的审批出口与实时消息通道，因此在发起它的这一轮结束后
  仍能继续运行并持续推送消息。
- 新增路由 `POST /api/sessions/:sessionId/tool-calls/:toolCallId/background`——成功返回 204，该 id 没有
  正在执行的调用时返回 404 `tool_call_not_found`，工具没有后台形态时返回 409 `tool_not_detachable`。
- 该动作是行内文字（链接样式，字号与行内其余文字一致），因此带它的行与不带它的行高度完全相同。它只在调用
  执行中、且只在主会话的卡片上出现；已经用 `run_in_background` 启动的调用不出现——那次调用的工作本来就已
  经在后台。
- 工作已转入后台的调用，在时长右侧标出 `[后台任务]`：与行内其余文字同为等宽字体，用的也是该行标注结果
  时一贯的方括号写法。该标记读自调用返回的说明文字，因此刷新页面后依然保留。
- 对话头部的后台任务标记保留原有图标与计数，配色由活动状态的绿色改为弱化灰，与会话列表行上的标记一致。
