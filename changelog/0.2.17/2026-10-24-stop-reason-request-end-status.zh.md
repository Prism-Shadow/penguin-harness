# 记录不再携带 stop_reason：Request 的结束记在 request_end.status

- **Date:** 2026-10-24
- **Type:** refactor
- **Scope:** `amsp`, `core`, `server`, `web`, `cli`
- **PR:** [#1309](https://github.com/Prism-Shadow/penguin-harness/pull/1309)
- **Breaking:** yes — 记录都不再带 `stop_reason`；每条 `tool_call_output` 都带必填的 `status`，停在输出上限的响应不再提交，而以 `retryable` 结束、带新错误码 `output_truncated`，轮次上限以 `abort` 记录结束 Task。

[English](2026-10-24-stop-reason-request-end-status.md)

`stop_reason` 字段从所有 AMSP 记录上移除。一次 Request 的结束原因只记一次，记在 `request_end.status` 上；工具结果由自己的 `status` 说明是什么；轮次上限是一条 `abort` 记录。每个流式条目照旧都有完整记录，被中断的也不例外。决定见 [PRFC-0022](https://github.com/Prism-Shadow/penguin-harness-design/pull/374)。

## 细节

- `request_end.status` 仍是四个 `StopReason` 取值。一次 Request 的条目是否进入模型历史，只看它：只有 `completed` 的 Request 才提交。
- 被中断、失败或截断提前结束的条目，照旧以 partial `stop` 收束，并写出装着已到达内容的完整记录。这样收束的工具调用带原样的参数文本，且从不派发：`GenerativeModel` 在进程内以 `markInterruptedToolCall`（由 core 导出，不写入记录）标记它，引擎跳过带标记的调用。完整流出的调用照旧在记录到达时即派发。
- 完整送达却停在输出上限的响应（`finish_reason` 为 `length`），不再以最后一项 `fatal` 的形式提交，而以 `retryable` 结束，带新的 `ErrorCode` `output_truncated`，`error_message` 写明输出达到了上限。MMSP 无法识别的结束原因（`unknown`）以 `retryable` 结束，错误码为 `malformed`。`GenerativeModel` 把这一轮移出 MMSP 的历史，但照常产出它的 `token_usage`（供应商已计费，成本中心照常计入；它不算作 Session 的一轮，也不新增失败记录）；引擎按重连阶梯、与其他可重试失败相同的规则重试，`[request_error]` 行写明原因；重试用尽时，运行与任何重试耗尽的 `retryable` 一样结束。
- 单轮尝试次数的绝对上限（`ContextEngineDeps.maxTurnAttempts`）缺省值由 20 改为 10，对所有可重试失败生效：收到过内容的尝试会让连续计数的阶梯归零，响应一再中途断开或停在输出上限的一轮，就由这条上限兜住。压缩请求不受影响，它们按自己的重连预算重试。
- 单发请求把停在上限的回答当作完成的回答读取：会话标题、`read_file` 的读图模型与模型测速。
- `tool_call_output.status` 必填：`completed`、`fatal`，或 `aborted`，后者表示调用没有运行到结束（被拒，或运行中被中断，此时输出为已产出的内容加上中断提示）。`retryable` 退出工具的词表。工具返回的 `ToolResult.stopReason` 改为 `ToolResult.status`（`ToolStatus`），构造函数 `toolCallOutput` 接收 `status`。`partial_*` 记录不带状态。
- 达到 `max_turns` 的 Task 以一条 `abort` 记录结束（`error_code: "max_turns"`，`error_message` 为 `reached max turns (N)`），不再写一条 `fatal` 的 assistant 提示。运行的 `RunCutoff` 带同一个错误码。Web App 与 CLI 显示为「[已停止]：已达到单次任务最大轮数」，Web App 的这一行带「重试」。
- 记录构造函数去掉了表示结束原因的参数：`assistantText(text, fidelity?)`、`thinkingMessage(thinking, fidelity?)`、`textMessage(role, text, fidelity?)`、`partialText(eventType, text?)`、`partialThinking(eventType, thinking?)`，`toolCall` / `partialToolCall` / `partialToolCallOutput` 不再接收 `stopReason`。`abortEvent` 可另带 `errorMessage`。
- SDK 的 `RunResult`：`abort` 判为 `aborted`（轮次上限带错误码 `max_turns`），按最后一条 assistant 文本 `fatal` 判定的规则取消，`text` 只包含以 `completed` 结束的 Request 的 assistant 文本。它的审批循环在调用的 Request 未完成即结束、而调用尚无决定时，不再等待这个调用。
- Web App 去掉了回复与思考后面的 `[停止原因]` 标记；未完成的 Request 结束时，其中尚无决定的调用卡片置为已中断；重试提示行为 `output_truncated` 给出专门的说法；回复能否作为分叉点，按它所在的 Request 是否完成判断。Trace 视图的标记与时间线显示记录的 `status`，未完成的 Request 没有派发的调用不占时间线泳道，Trace 分析 DTO 里的 `stopReason` 字段改名为 `status`。
- 成本中心的异常表把工具失败一律记为 `tool_fatal:<工具名>`。
- goal 与 continual-learning 钩子读取新的形状（钩子版本分别为 `2026.10.23.1` 与 `2026.10.24.1`）；continual-learning 改为每个以 `completed` 结束的 Request 记一轮，不再按 `token_usage` 计数，停在上限后的重试因此不多记一轮。
- 记录、AMSP、Agent API、运行循环、消息流、接口、工具、架构与 Session 和 Trace 等文档页随新的形状更新，记录页的 `stop_reason` 一节改为「结束原因」。

## 兼容性

- **API 调用方**：不要再读 `stop_reason`。一轮最多尝试 10 次后放弃，过去是 20 次。Request 的结束看它的 `request_end.status`，工具结果看 `tool_call_output.status`，轮次上限看 `error_code` 为 `max_turns` 的 `abort`。停在输出上限的响应现在以 `retryable`、`error_code` 为 `output_truncated` 结束并重试，过去则会提交；轮次上限的 `RunResult` 是 `aborted` 而不是 `fatal`。所在 Request 没有完成的 `tool_call`，只有 `approval_decision` 出现在该 `request_end` 之前才执行过。
- **基于 core 编写的代码**：调用记录构造函数时去掉表示结束原因的参数，给 `toolCallOutput` 传 `status`，工具的 `execute` 返回 `{ status }` 而不是 `{ stopReason }`。自行实现的 `LLMInterface` 提前收束工具调用时，照常写出完整记录，并让它经过 `markInterruptedToolCall`。
- **Trace 读者**：本版本之前写下的 Trace 在记录上保留 `stop_reason`，现已不再读取。没有 `status` 的 `tool_call_output` 读作 `completed`，因此旧 Trace 中失败、被拒或被中断的工具结果可能显示为完成。恢复旧 Trace 不受影响：重放本来就只按 `request_end.status` 判定一轮是否提交。不做迁移，也没有读取旧字段的兼容代码。
