# 被中断的条目不留完整记录

- **Date:** 2026-10-24
- **Type:** refactor
- **Scope:** `core`, `server`, `web`, `docs`
- **PR:** [#1310](https://github.com/Prism-Shadow/penguin-harness/pull/1310)
- **Breaking:** yes — 被截断的条目不写完整记录：被中断截断的文本或思考，以及执行中被中断的工具调用的输出。

[English](2026-10-24-interrupted-items-leave-no-record.md)

没有走到结束的条目不再写完整记录。它的分片照常实时流出、以 `stop` 收束，其后的 `request_end` 与 `abort` 说明 Request 与运行如何结束。[#1309](https://github.com/Prism-Shadow/penguin-harness/pull/1309) 已对被流截断的工具调用这样处理，本次补齐其余条目。决定见 [PRFC-0022](https://github.com/Prism-Shadow/penguin-harness-design/pull/374)。

## 细节

- 请求被中断、失败或断流时，`GenerativeModel` 只以 partial `stop` 收束仍在流式中的文本或思考。已收到 done 项的条目照常写出，因此被截断的响应仍保有它的记录。
- 用户在工具执行中途中断时，Environment 以该调用的分片（其中包括 `[interrupted: tool aborted by user]` 提示）与 partial `stop` 收束，不写 `tool_call_output`。以其他方式结束的调用照常写出。
- 引擎为下一次请求给这样的调用配上一条既不上流也不落盘的输出：调用已流出的内容，末尾是那条提示。补发块（`[turn_aborted]`、`[turn_retried]`）照旧携带被中断截断的文本或思考，按其分片拼出。恢复 Session 时，该调用照旧由重放的占位输出配对。
- Request 结束后，Web App 不再等待文本或思考的完整记录，实时视图保留已流出的内容；刷新后被中断的回复不再显示，停止标记仍在。组件画廊的模拟流与历史随之调整。
- Trace 分析把执行中被中断的调用的区间在 `abort` 处收束，标为 `aborted`。
- 记录、AMSP、运行循环、消息流与工具文档页描述新的形状。

## 兼容性

- **API 调用方与 Trace 读者**：被中断的文本、思考或执行中的工具调用在实时流上只有分片，没有完整记录。要得知 Request 或运行被中途截断，读其后的 `request_end.status` 与 `abort`；有 `tool_call` 而没有 `tool_call_output` 的调用，是执行中被中断（或从未派发）的调用。
- **基于 core 编写的代码**：自行实现的 `Environment` 在调用被中断时，现在可以不写完整 `tool_call_output` 就结束；配对由引擎补上。
- 本版本之前写下的 Trace 里，被中断的条目仍是完整记录，照其写下的样子读取。不做迁移。
