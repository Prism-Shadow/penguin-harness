# 压缩把交接文件留给下一个上下文，且一经开始必定开启它

- **Date:** 2026-11-11
- **Type:** feature
- **Scope:** `core`, `amsp`, `server`, `web`, `cli`
- **PR:** [#1491](https://github.com/Prism-Shadow/penguin-harness/pull/1491)

[English](2026-11-11-compaction-never-gives-up.md)

`summarize` 压缩现在可以把篇幅超过一段的细节存成本 Session scratchpad 下的交接文件：与摘要写在同一回复里，或用至多 `compaction.max_rounds` 个由 harness 计数的工具轮（默认 3）。摘要按固定小节写成，末尾附被压缩上下文的 Trace 文件路径及其查询方法。已开始的压缩不再放弃：新上下文以完整摘要、写到一半被截断的摘要，或 harness 依 Trace 文件构造的交接说明开头。只有用户中断压缩，或下一个上下文根本无法开启时，才保留原上下文。

## 交接文件与工具轮

- 新的默认压缩 Prompt 要求按六个小节（请求、决定与约束、进展、错误与修正、文件、下一步）给出摘要，并把交接文件写在 `<scratchpad>/handoff/` 下：用 `write_file` / `edit_file`，能与摘要同一回复就同一回复。占位符为 `{{SCRATCHPAD_DIR}}` 与 `{{MAX_ROUNDS}}`。
- 压缩期间模型可以调用 `read_file`，以及绝对路径位于本 Session scratchpad 内的 `write_file` / `edit_file`。其余调用以 `fatal` 的 `[tool error]` 应答，既不执行也不询问。放行的调用与其他调用一样遵循 Session 的审批模式。
- 轮数由 harness 计数：每轮输出之后附一行，写明已用与剩余的轮数。轮数用尽、上下文占用已达 `context_window − 12288`，或 `max_rounds` 为 `0` 时，此后的调用一律以 `[tool error] no tool round is left in this compaction; reply with the summary` 拒绝。
- 回复中既有带标记的摘要、又有工具调用时，压缩在这一次请求内结束：其调用照常应答，不再向旧模型发请求。
- 没有推进的回复（没有摘要、调用全部被拒，或停在输出上限）立即附一行纠正提示重发，至多两次。传输失败按 `compactionMaxReconnects`（默认 5）重试。输入带图片的请求被拒时，把图片替换后再发一次。
- 摘要之下 harness 列出压缩期间的工具调用及其输出（至多最后 12 个），下一个上下文据此看到哪些交接文件真正写成了。随后 `[context_summary]` 块点名被关闭的 Trace 文件、更早文件的位置，以及先列出匹配行号、再用 `read_file` 的 `offset` / `limit` 只读这些行的方法，按 Session 的 shell 措辞。模型切换的 `[model_switch_from]` 块带同样的指引。

## 取不到完整摘要时

- 被截断的回复在 `[summary]` 标记内已写出至少 400 字符时，新上下文以其中最长的一段开头，并标明已被截断；没有这样的片段时，以交接说明开头。交接说明引述被压缩上下文的第一条与最后八条用户消息、最后完成的一轮，以及压缩期间的工具调用，总长不超过 4000 Token，并指向 Trace 文件；构造它不调用模型，不会失败。
- 这样的压缩以 `compaction_end{status: completed}` 收尾，并携带最后一次失败的统一错误对（`error_code` / `error_message`）。重放据此从文件重建同一个开头；不带错误对的 `completed` 照旧重放。
- 模型切换取不到摘要时，有抢救的片段就以它开在目标模型上，否则照旧以 `[model_switch_from]` 块开在目标模型上。
- 下一个上下文在写 `compaction_end` 之前开启，Trace 因此不会为一个并不存在的上下文记下压缩完成。同模型轮换时读不出 Agent State，新上下文沿用正在生效的配置重新开启，stderr 记一行，开头附一行 harness notice，提示模型修复 `system_config.yaml`。下一个上下文无法开启时，压缩以 `fatal` 收尾，旧上下文保持为当前上下文，Task 中途的运行以 `RunCutoff{kind: "compaction_failure"}` 结束；模型切换此时保持原模型，`session.switchModel` 返回 `fatal` 而不抛出。

## 触发阈值

- 有效的压缩阈值改为 `min(max_context_length, context_window − 预留)`，预留 = `min(clamp(context_window / 8, 8192, 32768), context_window / 2)`，取代固定的 2048。窗口决定阈值的模型因此更早压缩：200k 窗口从 197,952 提前到 175,000，没有窗口的条目从 125,952 提前到 112,000，32k 窗口从 30,720 提前到 24,576，262k 窗口从 256,000 提前到 229,376；窗口为 288,768 Token 及以上的不变。Web App 的上下文环随阈值移动。

## 输出流、Web App、CLI 与服务端

- `compaction_begin` 与 `compaction_end` 之间的输出流现在包括每个压缩请求的 `request_begin` / `request_end`、思考与文本，以及每个工具调用（执行的与被拒绝的）及其审批决定与输出。压缩 Prompt、每轮提示与纠正提示只写 Trace。新上下文开启时的 MCP 连接事件对与 `tool_list_ready` 排在 `compaction_end` 之后。
- Web App 的压缩行在「工作」节列出这些调用，被拒绝的调用是一张失败的工作卡；「压缩结果」显示被采用的摘要。降级完成时标题仍为「压缩完毕」，状态图标改用 attention 色调，悬停提示说明摘要被截断，或新上下文改以 Trace 交接说明开头及其原因。`fatal` 收尾时写明未能开启新的上下文、保留当前上下文。
- CLI 的完成行后加注「(summary cut off)」或「(no summary: Trace hand-off — <原因>)」，`fatal` 行写明保留当前上下文。
- 服务端把降级完成记为 `compaction_degraded`（expected），把 `fatal` 记为 `compaction_failed`（unexpected）。压缩期间被 harness 拒绝的调用不再记为工具失败。
- 分叉时，摘要与交接说明中的交接文件路径（含被引调用参数里 JSON 转义的写法）与 Trace 路径改写为分叉自己的副本。

## 行为变化

- 窗口决定阈值的模型更早压缩，数值见「触发阈值」。
- 摘要失败的压缩不再结束运行，也不再保留原上下文等下次重试：对话在新上下文中继续，以被截断的摘要或交接说明开头。只有用户中断，或下一个上下文无法开启时，才保留当前上下文。
- 做了工具调用的压缩回复不再被判为无效：调用被应答或拒绝，压缩继续。
- `system_config.yaml` 损坏不再让运行在轮换时结束，新上下文沿用正在生效的配置开启。

## 内核

- 内核版本前进到 `2026-11-11`，变动的是运行参数标签页（`compaction.max_rounds` 与新的 Prompt）。未编辑过的运行参数标签页在下一次内核更新时前进，编辑过的保留。已存的 Prompt 照常可用，配置里没有 `max_rounds` 时按 3 读取。
