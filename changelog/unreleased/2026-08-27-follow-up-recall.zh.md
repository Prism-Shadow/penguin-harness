# 排队中的跟进消息一律可撤回

- **Date:** 2026-08-27
- **Type:** fix
- **Scope:** `server`, `web`, `docs`

[English](2026-08-27-follow-up-recall.md)

从绑定的聊天渠道发往繁忙 Session 的消息进入跟进队列时，不带撤回所需的原始内容，于是 Web App 中
这条排队行内容为空，撤回按钮又答以「该消息已发出」——而消息其实仍在等待。现在队列为每一条条目都
保留该内容，两个撤回端点也不再共用同一个错误码。

## 细节

- 调用方未提供时，`startTask` 从输入本身推导跟进消息的撤回内容；因此直接经 manager 入队的跟进消息
  ——飞书与 Telegram 走的 messaging bridge 路径——与经 HTTP 提交的一样带有文本和内联图片。输入框中的
  排队行会显示等待中的内容，其撤回按钮也能真正撤回。
- `DELETE /api/sessions/:id/follow-ups/:followUpId` 仅拒绝已不在队列中的 id，并以 409
  `follow_up_started` 拒绝；`DELETE /steer/:steerId` 对已被模型收到的插话仍返回 `not_pending`。
- Web App 的提示文案随错误码分开：撤回过晚的跟进消息显示「该跟进消息已开始发送，无法撤回。」，
  撤回过晚的插话显示「该插话已随本轮送达模型，无法撤回。」。
