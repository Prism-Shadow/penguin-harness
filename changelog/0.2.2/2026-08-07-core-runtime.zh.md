# Core：默认轮次上限改为无限、由模型窗口推导的限额、更慢更简单的重试、并发与崩溃下的 Trace 完整性

- **Date:** 2026-08-07
- **Type:** fix
- **Scope:** `core`, `docs`
- **PR:** [#232](https://github.com/Prism-Shadow/penguin-harness/pull/232), [#234](https://github.com/Prism-Shadow/penguin-harness/pull/234), [#235](https://github.com/Prism-Shadow/penguin-harness/pull/235), [#249](https://github.com/Prism-Shadow/penguin-harness/pull/249)
- **Issue:** [#215](https://github.com/Prism-Shadow/penguin-harness/issues/215), [#218](https://github.com/Prism-Shadow/penguin-harness/issues/218)

[English](2026-08-07-core-runtime.md)

## 默认轮次上限改为无限

新建 Agent 的 `system_config.yaml` 现在默认 `max_turns: -1`（无限）而不是 `100`，SDK 对省略 `maxTurns` 的兜底也与之一致，因此长时间的 Agent 运行不会再被逐 Task 的轮次上限意外截断；正整数仍然会限制该 Task，而 `-1` 仍是唯一被接受的非正取值。已有 Agent 逐字保留其已存的 `max_turns`，通过设置页的「恢复默认配置」来采纳新默认值。目标模式那道 100 轮的失控兜底未变，但显式的 `maxRounds: -1` 现在可以禁用它（内部旋钮，有回归测试）。

## 由模型窗口推导的限额（vLLM 及其他小窗口端点）

面向小窗口的 OpenAI 兼容端点运行（例如带 `--max-model-len 32768` 的本地 vLLM）此前会以三种方式失败：请求会 400，因为配置的 `max_tokens` 无论输入已占据窗口多少都会照发上线；而压缩阈值（默认 128000）在该窗口内根本无法触及。现在（[#218](https://github.com/Prism-Shadow/penguin-harness/issues/218)）：

- 每个请求的有效输出上限是 `min(配置的 max_tokens, context_window − 估算输入 − 1024)`，下限为 512——对大窗口的云端模型是空操作。输入依据上一次请求真实的 `token_usage` 加上一个偏高估计的字符启发式来估算；图片（包括工具输出中的图片）按一个固定额度计入，而不是原始 base64。没有配置 `context_window`（或其值低于 4096）的条目不做钳制；一次真正起约束作用的钳制会打印一行诊断。
- 有效的压缩阈值是 `min(配置的 max_context_length, context_window − 2048)`（为摘要请求自身的输出留出余量），取代原先「窗口的 75%」的规则——一个 32k 窗口的模型现在会在约 30.7k 处压缩，而不是永远不压缩。该值在使用时推导；已存配置绝不被重写。
- 文档新增一节「本地 / 自托管的 OpenAI 兼容端点（例如 vLLM）」（`--enable-auto-tool-choice`、`--tool-call-parser`，把条目的上下文窗口设为 `max_model_len`）。

## 更慢、更简单的 LLM 重试

重试阶梯的基数从 250ms 改为 2000ms（2s/4s/8s/16s/30s，合计约 60 秒的耐心；次数与上限未变），因此瞬时的 Provider 故障获得了真正的恢复窗口，而每一次计划中的等待都超过 Web 应用倒计时显示的下限。分类简化为「除认证外每一种 LLM 错误都重试」：明确的认证信号仍然立即停止，其余一切——裸的 403、400、429、5xx、配额/订阅类消息、传输错误——都走这条阶梯，只有在耗尽之后才失败。配额检测的那套机制（`isQuotaExhaustedError` 及其消息启发式）已被移除。刻意的取舍：真正永久性的错误现在会先烧完整条阶梯才浮出水面。

## 并发写入与崩溃下的 Trace 完整性

Trace 追加在写入器内部被串行化，因此并发的产出方（并行工具、模型流）不再能把一条数兆字节的记录——例如一个 base64 图片 Data URL——撕成无效的 JSONL（[#215](https://github.com/Prism-Shadow/penguin-harness/issues/215)）。Trace 读取是尽力而为的：修复之前受损文件中位于中间的畸形行会被跳过，并给出一条截断的 stderr 诊断，同时保留每一条可解析的记录，因此此前已损坏的会话得以重新恢复与渲染（即便对严重受损的文件，这个跳过也是 O(n) 的）；服务端的 Trace 导入仍然严格校验，而对末行截断的容忍未变。Session 索引的头部读取器共用这条容忍路径，因此一个受损的头部窗口不会再永久阻塞对账。

一次现场事故堵上了最后那道撕裂窗口（[#249](https://github.com/Prism-Shadow/penguin-harness/pull/249)）：`fs.appendFile` 会把大于 512 KiB 的载荷拆成多次底层写入——正是这一点，让一个串行化之前的构建在恰好 524288 字节的分块边界上，把一个 `request_end` 事件插进了一条 1.48 MB 图片记录的中间——而即便有了串行化追加，分块之间的进程死亡仍会留下一条残缺记录，被后续追加粘接上去。每条记录现在都在一个 O_APPEND 句柄上以单次 `write(2)` 追加，因此崩溃至多截断最后一条记录，而绝不会在文件中间把一条记录劈开。在 Session 恢复继续写入一个既有分片之前，写入器会探测其末尾：一个不以换行结尾的文件会让下一条记录另起一行，因此被崩溃撕裂的末尾绝不会吞掉在它之后追加的记录（记录写到一半失败，例如 ENOSPC，也以同样方式痊愈）。这两项保证都记录在文档的 sessions-and-traces 页上。
