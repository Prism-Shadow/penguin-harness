# 运行中发送新增「打断」，与插话、排队并列

- **Date:** 2026-11-02
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#1421](https://github.com/Prism-Shadow/penguin-harness/pull/1421)

[English](2026-11-02-interrupt-send.md)

输入区的运行中发送方式在插话（缺省）与排队之外新增第三种：打断。以打断方式发送会停止本轮，并把消息接在被打断的那一轮之后立即发出。被打断那一轮已经产出的内容排在这条消息之前一起发出，与按「停止」后发下一条消息的做法相同，因此已提交的历史不变，Prompt 缓存照常命中。尚未送达的插话与按「停止」时一样退回输入框。

## 细节

- `POST /api/sessions/:id/tasks` 接受 `interrupt: true`。会话忙时，消息排到 follow-up 队列最前（排在此前尚未发出的打断之后，同样受队列上限约束），并按 `POST /abort` 的同一路径中止当前运行；在它之前排队的消息照常在它之后发出。会话空闲时直接发起 Task。与 `queueIfBusy` 或 `goal` 同带时返回 400。
- `POST /api/sessions/:id/interrupt` 立即发出一条等待中的消息：`followUpId` 指定的排队跟进消息（保留原 id），或 `steerId` 指定的未送达插话。该消息已不在等待时返回 409 `follow_up_started` 或 `not_pending`。
- 被停止的运行收束期间，打断条目以 `interrupt: true` 留在排队镜像中，输入区显示为一行「正在打断，随后发送」，可以像其他排队消息一样撤回。
- 每条排队中的跟进消息和每条排队中的插话，都在撤回控件之前带一个文字链接「打断」。
