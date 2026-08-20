# 将排队中的 steering 与后续消息撤回到输入框

- **Date:** 2026-08-16
- **Type:** feature
- **Scope:** `core`, `server`, `web`
- **PR:** [#321](https://github.com/Prism-Shadow/penguin-harness/pull/321)
- **Issue:** [#287](https://github.com/Prism-Shadow/penguin-harness/issues/287)

[English](2026-08-16-recall-queued-messages.md)

运行途中仍在等待的消息——尚未投递的 steering 消息，或排在当前运行之后的后续消息——现在可以撤回到输入框，编辑之后重新发送。这份实现脱胎于 @Myriad-Dreamin 提出的草稿 [#304](https://github.com/Prism-Shadow/penguin-harness/pull/304)。

## Web App

- 输入框上方的每一条排队提示行——尚未投递的 steering 镜像，以及新增的逐条后续消息列表——末尾都带一个纯图标的撤回控件：一枚向后弯回的箭头，不带文字标签，尺寸与灰度沿用提示行上其他图标控件，无障碍名称为「Recall」，并配一个说明其作用的 tooltip。
- 点击它会在服务端撤下这条消息，并把它原本的内容恢复进草稿。文本落在当前已输入内容的前面，并与文本框的实时值合并，因此请求在途期间敲下的字不会被覆盖；图片与文件附件则以输入框附件条的形式回来（文件从 Session scratchpad 读回，那里的副本随后删除）。撤回一条后续消息还会恢复它排队时携带的单轮思考档位；若撤回带回了文件附件，暂存的 goal 标签会被释放，因为 goal 草稿不能携带文件。
- 发送在途期间撤回控件置为禁用；服务端拒绝的撤回以 toast 呈现，提示行则自行退场。
- 每次撤回都会重新广播 `task_state`，于是提示行在其他标签页里也会消失——包括最初发出这条消息的那个标签页，它在服务端的镜像到达后就撤下本地的「steering 已排队」桥接。

## Server

- `DELETE /api/sessions/:id/steer/:steerId` 与 `DELETE /api/sessions/:id/follow-ups/:followUpId` 撤下一条仍在等待的消息，并返回它原本的内容 `{text, images, files}`，后续消息还会带上它的 `thinkingLevel`。
- 撤回所需的句柄随 `task_state` 事件下发：`pendingSteering` 的条目新增了 `id`，新增的 `pendingFollowUps` 字段在既有的 `queued` 计数旁列出每条排队后续消息的内容。SSE 订阅时的快照同样携带 `pendingFollowUps`，页面重新加载后正是靠它重建这些提示行。
- 已经送达模型的 steering 消息，以及已经自动开跑的后续消息，都回 409 `not_pending`。落在运行转入空闲与后续消息 drain 加锁出队之间那道缝隙里的撤回恰好只成功一次，drain 随后不会启动任何任务。

## Core

- `ContextEngine` 与 `Session` 新增了 `unsteer(input)`：在投递之前按对象标识撤下一条排队中的 steering 输入，队列一旦排空即拒绝撤回。
