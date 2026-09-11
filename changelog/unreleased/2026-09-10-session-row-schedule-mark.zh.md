# 会话行的定时任务标记不再闪烁，并退回次要位置

- **Date:** 2026-09-10
- **Type:** fix
- **Scope:** `web`
- **PR:** [#677](https://github.com/Prism-Shadow/penguin-harness/pull/677)

[English](2026-09-10-session-row-schedule-mark.md)

会话行在绑定了定时任务时会佩戴一个闹钟标记，此前在多个对话之间切换时它会时隐时现，且用的是与运行中沙漏、
待审批徽章相同的琥珀色。定时任务 store 改为按 Agent 分别缓存列表，不再让唯一的槽位指向某一个 Agent；标记
本身也改用与它同类的次要墨色。

## 细节

- store 按 project 与 agent 为键保存列表、错误与进行中的请求。切换到另一个 Agent 不再丢弃前一个 Agent 已
  有的列表；在另一个 Agent 的请求尚未返回时发起的读取，会为真正被请求的那个 Agent 发出请求，而不是被那个
  更早的请求代答。
- `refreshSchedules` 改为接收要刷新的 scope。Dock 的定时任务面板在轮询以及每次新建、编辑、启停、删除之后
  都会指明当前对话的 Agent；窗口重新获得焦点与 `schedule_fired` / `schedule_queued` 事件只刷新有已挂载读者
  正在展示的 scope。
- 某个 Agent 的列表尚未被读取过时，会话列表保留已经显示在屏幕上的标记，而不再把「尚未加载」当成「没有
  Session 有定时任务」。
- 该标记移到了置顶图标与消息中继图标旁边、实时状态图标之前，三者统一从共享的 tone token 取 `muted`。
