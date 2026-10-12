# 运行失败后可以一键重试

- **Date:** 2026-10-10
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`
- **PR:** [#1018](https://github.com/Prism-Shadow/penguin-harness/pull/1018)

[English](2026-10-10-retry-failed-run.md)

运行以 fatal 错误结束，或自动重试次数用完后，对话里以前只显示报错。失败那一轮的输入虽然留着待下一条消息补发，但要再发一次只能先打字。现在错误行上带**重试**按钮。

- `POST /api/sessions/:id/retry` 以空输入启动一次 Task，引擎只补发留下的输入：不新增用户消息，不在 Trace 中写入新的输入记录，也不咨询 user-prompt Hook。没有留下的输入时（例如已随后续消息发出）返回 `409 nothing_to_retry`。
- Web App 在错误行和已放弃的重试提示行上显示**重试**，条件是该行是对话的最后一条、会话空闲。重启后同样可用，因为恢复会话时会从 Trace 重建留下的输入。修好原因（例如更新 API key）后，点重试即可继续对话，不必重新输入。
