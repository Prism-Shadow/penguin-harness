# 记录不再携带 stop_reason：Request 的结束记在 request_end.status

- **Date:** 2026-10-24
- **Type:** refactor
- **Scope:** `amsp`, `core`, `server`, `web`, `cli`
- **PR:** [#1309](https://github.com/Prism-Shadow/penguin-harness/pull/1309)
- **Breaking:** yes — 记录都不再带 `stop_reason`；`request_end.status` 新增 `truncated`，每条 `tool_call_output` 都带必填的 `status`，轮次上限以 `abort` 记录结束 Task。

[English](2026-10-24-stop-reason-request-end-status.md)

`stop_reason` 字段从所有 AMSP 记录上移除。一次 Request 的结束原因只记一次，记在 `request_end.status` 上；工具结果由自己的 `status` 说明是什么；轮次上限是一条 `abort` 记录。决定见 [PRFC-0022](https://github.com/Prism-Shadow/penguin-harness-design/pull/374)。

## 细节

- `request_end.status` 的类型是 `RequestEndStatus`，即四个 `StopReason` 取值加上 `truncated`，由 `@prismshadow/amsp` 导出。`StopReason` 本身不变，仍是 `compaction_end` 与 MCP 连接结果的类型。
- 供应商没有正常结束的响应（`finish_reason` 为 `length` 即达到输出上限，或 `unknown`）以 `truncated` 收尾，不再以最后一项 `fatal` 的形式提交。`GenerativeModel` 把这一轮移出 MMSP 的历史，但照常产出它的 `token_usage`（供应商已计费，成本中心照常计入；它不算作 Session 的一轮，也不新增失败记录）；引擎按重连阶梯重试，`[request_error]` 行写明 finish reason。截断的尝试不让阶梯归零，连续截断会用尽 `maxReconnects`，最后一条 `request_end`（`truncated`、不带 `retry_in_ms`）结束运行，与 `retryable` 用尽时相同。截断的压缩请求计入压缩的重试预算。
- 单发请求把截断的回答当作完成的回答读取：会话标题、`read_file` 的读图模型、模型测速与视觉探测。
- `tool_call_output.status` 必填：`completed`、`fatal`，或 `aborted`，后者现在表示调用被拒、没有执行。`retryable` 退出工具的词表。工具返回的 `ToolResult.stopReason` 改为 `ToolResult.status`（`ToolStatus`），构造函数 `toolCallOutput` 接收 `status`。`partial_*` 记录不带状态。
- 达到 `max_turns` 的 Task 以一条 `abort` 记录结束（`error_code: "max_turns"`，`error_message` 为 `reached max turns (N)`），不再写一条 `fatal` 的 assistant 提示。运行的 `RunCutoff` 带同一个错误码。Web App 与 CLI 显示为「[已停止]：已达到单次任务最大轮数」，Web App 的这一行带「重试」。
- 被流截断的工具调用（参数没有完整到达）以 `partial_tool_call` 的 stop 收束，不写完整的 `tool_call`。每一条完整的 `tool_call` 都会被派发。
- 记录构造函数去掉了表示结束原因的参数：`assistantText(text, fidelity?)`、`thinkingMessage(thinking, fidelity?)`、`textMessage(role, text, fidelity?)`、`partialText(eventType, text?)`、`partialThinking(eventType, thinking?)`，`toolCall` / `partialToolCall` / `partialToolCallOutput` 不再接收 `stopReason`。`abortEvent` 可另带 `errorMessage`。
- SDK 的 `RunResult`：`abort` 判为 `aborted`（轮次上限带错误码 `max_turns`），终局的 `request_end` 可以是 `truncated`，按最后一条 assistant 文本 `fatal` 判定的规则取消，`text` 只包含以 `completed` 结束的 Request 的 assistant 文本。
- Web App 去掉了回复与思考后面的 `[停止原因]` 标记；被截断的调用卡片在其 Request 结束时置为已中断；`truncated` 显示重试提示行；回复能否作为分叉点，按它所在的 Request 是否完成判断。Trace 视图的标记与时间线显示记录的 `status`，Trace 分析 DTO 里的 `stopReason` 字段改名为 `status`。
- 成本中心的异常表把用尽重试的 `truncated` 记为 `llm_failed`，被重试的记为 `llm_retried`；工具失败一律记为 `tool_fatal:<工具名>`。
- goal 与 continual-learning 钩子读取新的形状（钩子版本 `2026.10.23.1`），penguin-sdk 技能在状态列表里加上 `truncated`。
- 记录、AMSP、Agent API、运行循环、消息流、接口、工具、架构与 Session 和 Trace 等文档页随新的形状更新，记录页的 `stop_reason` 一节改为「结束原因」。

## 兼容性

- **API 调用方**：不要再读 `stop_reason`。Request 的结束看它的 `request_end.status`（现在可能是 `truncated`），工具结果看 `tool_call_output.status`，轮次上限看 `error_code` 为 `max_turns` 的 `abort`。`RunResult.status` 可能是 `truncated`，轮次上限的结果是 `aborted` 而不是 `fatal`。
- **基于 core 编写的代码**：调用记录构造函数时去掉表示结束原因的参数，给 `toolCallOutput` 传 `status`，工具的 `execute` 返回 `{ status }` 而不是 `{ stopReason }`。
- **Trace 读者**：本版本之前写下的 Trace 在记录上保留 `stop_reason`，现已不再读取。没有 `status` 的 `tool_call_output` 读作 `completed`，因此旧 Trace 中失败、被拒或被中断的工具结果可能显示为完成。恢复旧 Trace 不受影响：重放本来就只按 `request_end.status` 判定一轮是否提交。不做迁移，也没有读取旧字段的兼容代码。
