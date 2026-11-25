# input_subagent 留在后台的续跑轮会回报完成

- **Date:** 2026-11-25
- **Type:** fix
- **Scope:** `core`
- **PR:** [#1864](https://github.com/Prism-Shadow/penguin-harness/pull/1864)
- **Issue:** [#1861](https://github.com/Prism-Shadow/penguin-harness/issues/1861)

[English](2026-11-25-input-subagent-done-report.md)

`input_subagent` 发起的续跑轮如果到窗口结束时还没跑完，会转到后台继续跑，但此前什么都没给它挂上。这一轮结束时父 Session 收不到任何消息，只有以 `run_in_background` 启动、并且一直没让出过槽位的子会话例外。槽位被腾走后又恢复的子会话、一直只靠轮询访问的子会话，都是悄无声息地跑完。现在这样的一轮与后台启动拿到的东西相同。

## 细节

- `input_subagent` 返回时，它发起的那一轮若还在运行，子会话会挂上完成回报、常驻审批出口和实时消息转发。这一轮收束时父 Session 收到一条 `[background_task_done]` 消息，子会话的消息继续实时推送到前端，子会话发起的审批也不必等下一次轮询就能送到用户面前。
- 回报里写的是刚结束这一轮的续跑 prompt，而不是子会话最初启动时的 prompt。
- 调用的说明文字改为告知完成结果会以 user 消息送达；常驻审批出口已经在处理的待审批请求，不再提示模型回来轮询。
- 在窗口内就收束的续跑轮，结果仍由这次调用自己返回：调用前没有挂回报的子会话不会为它另收一条通知。空 prompt 轮询、对运行中的一轮插话以及 `abort` 都不挂任何东西。
- `run_subagent` 的后台启动与前台运行中途转后台，改由同一个辅助函数挂这三样，行为不变。
