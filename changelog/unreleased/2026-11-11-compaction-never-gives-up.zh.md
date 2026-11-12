# 压缩把交接文件留给下一个上下文，且一经开始必定开启它；被拒的请求同样交接

- **Date:** 2026-11-11
- **Type:** feature
- **Scope:** `core`, `amsp`, `server`, `web`, `cli`
- **PR:** [#1491](https://github.com/Prism-Shadow/penguin-harness/pull/1491)

[English](2026-11-11-compaction-never-gives-up.md)

`summarize` 压缩现在可以把篇幅超过一段的细节存成本 Session scratchpad 下的交接文件：与摘要写在同一回复里，或用由 harness 计数的工具轮。流程只有一条规则，用到的三段文字都在 Agent 的 `system_config.yaml` 里：harness 发出 `compaction.prompt`；不是摘要的回复，其工具调用经应答后追加 `compaction.reminder` 再问，至多 `compaction.max_rounds` 次（默认 8）；取到摘要时，下一个上下文以摘要加一行被关闭 Trace 文件的指针开头；取不到时，以依该 Trace 文件填好的 `compaction.handoff_note` 开头。已开始的压缩不再放弃：只有用户中断压缩，或下一个上下文根本无法开启时，才保留原上下文。已完成过一轮的上下文上，Provider 拒绝按原样发出的请求时，运行不再结束：以同一种交接说明交接上下文，Task 照常继续。

## 流程与三段文字

- 新的默认 `compaction.prompt` 要求按六个小节（请求、决定与约束、进展、错误与修正、文件、下一步）给出摘要，并把交接文件写在 `<scratchpad>/handoff/` 下：用 `write_file` / `edit_file`，能与摘要同一回复就同一回复，每个交接文件取新名，因而无须先读。它要求模型在约三个工具轮内完成，不写上限。
- 压缩期间模型可以调用 `read_file`，以及绝对路径位于本 Session scratchpad 内的 `write_file` / `edit_file`。其余调用以 `fatal` 的 `[tool error]` 应答，既不执行也不询问。放行的调用与其他调用一样遵循 Session 的审批模式。
- 已提交的回复只分摘要与不是摘要。不是摘要、且已应答的回复不足 `max_rounds` 个时，应答其调用，其后追加 `compaction.reminder`（默认为 `Tool round {{ROUNDS_USED}} done. Reply with the summary as soon as the hand-off files are written.`）；空回复与调用全部被拒的回复同样用掉一轮。轮数用尽后，调用一律以 `[tool error] the compaction request expects a summary, not tool calls` 应答，此后仍不是摘要的回复以交接说明结束压缩。回复中既有已闭合的摘要、又有工具调用时，压缩在这一次请求内结束：其调用照常应答，不再向旧模型发请求。
- 传输失败按 `compactionMaxReconnects`（默认 5）重试。压缩请求因图片被拒时，把图片替换后再发，该次尝试与普通的轮一样记为 `retryable` / `image_rejected`。其余情形都不再重发：停在输出上限的回复、被拒的请求与耗尽的重试阶梯都以交接说明结束压缩。
- 以混用括号的标记（`[/summary>` 或 `</summary]`）收尾的摘要读作已闭合，游离的这类标记不再带入下一个上下文。
- `[context_summary]` 块内是摘要、一个空行与 `Trace file of the compacted context (JSONL, one record per line): <路径>`。怎样查询这个文件由 `trace-lookup` Skill 说明（见 [trace-lookup 插件](2026-11-12-trace-lookup-skill.zh.md)），指针与交接说明都不点名它。
- harness 在三段文字中填入 `{{SCRATCHPAD_DIR}}`，在 `reminder` 中填入 `{{ROUNDS_USED}}` 与 `{{ROUNDS_LEFT}}`，在 `handoff_note` 中填入 `{{ERROR}}`、`{{USER_MESSAGES}}`、`{{LAST_TURN}}` 与 `{{TRACE_PATH}}`；没有内容可引的占位符读作 `(not recorded)`。空白的 `reminder` 只发一轮的工具输出，空白的 `handoff_note` 只留引述的内容。一次压缩使用开始它的那个检查点读到的这一节。

## 取不到完整摘要时

- 新上下文以交接说明开头。默认的 `compaction.handoff_note` 说明没有摘要的原因（Provider 拒绝了请求时用它的原话），并提醒不要重建同样的输入；引述被压缩上下文的第一条与最后三条用户消息（各至多 1,500 字符），以及最后完成的一轮的文本与其最后四个工具调用和输出（各至多 500 字符）；点名 Trace 文件与交接目录；最后请模型接着做。构造它不调用模型，不会失败。
- 压缩请求被 Provider 拒绝时，不论错误码（含压缩所用模型鉴权失败或不可用），以及回复停在输出上限时，都立即走这条退路。
- 这样的压缩以 `compaction_end{status: completed}` 收尾，并携带最后一次失败的统一错误对（`error_code` / `error_message`）。重放据此按恢复时的 `handoff_note` 由文件重建交接说明；不带错误对的 `completed` 照旧重放。
- 模型切换取不到摘要时，照旧以 `[model_switch_from]` 块开在目标模型上。
- 下一个上下文在写 `compaction_end` 之前开启，Trace 因此不会为一个并不存在的上下文记下压缩完成。同模型轮换时读不出 Agent State，新上下文沿用正在生效的配置重新开启，stderr 记一行。下一个上下文无法开启时，压缩以 `fatal` 收尾，旧上下文保持为当前上下文，Task 中途的运行以 `RunCutoff{kind: "compaction_failure"}` 结束；模型切换此时保持原模型，`session.switchModel` 返回 `fatal` 而不抛出。

## 被拒的请求交接

- Provider 的确定性 4xx 现在按 HTTP 状态码分类：400、413、415 与 422 为 `rejected`（拒绝按原样发出的这次请求）；其余（402、403、404 等）为新增的 `error_code` `denied`（不为该账号或模型提供服务）。401 仍为 `auth`，408 与 429 照旧重试。
- 已完成过一轮的上下文上，输入不带图片的普通请求被拒为 `rejected` 时，运行不再结束。该次尝试记为 `request_end{retryable, error_code: rejected, retry_in_ms: 0}`，随后一对不含请求的压缩事件关闭这个上下文（`compaction_end{completed}` 带 Provider 的报错、不带 `attempt`），下一个上下文以交接说明开头。同一轮在交接说明之后重发，只带被拒输入中的文本，不占 `max_turns`。无论 `compaction.mode` 为何、阈值是否关闭都如此，每次运行至多三次。
- 上下文的首个请求被拒、一次运行中的第四次被拒，以及 `denied`、`auth`、`unsupported`、`invalid_input` 的请求，仍然结束运行并保留上下文。输入带图片的被拒请求先把图片替换后重发，再次被拒才交接。下一个上下文无法开启时，运行以 `RunCutoff{kind: "compaction_failure"}` 结束，保留原上下文。

## 触发阈值

- 有效的压缩阈值改为 `min(max_context_length, context_window − 预留)`，预留 = `min(clamp(context_window / 8, 8192, 32768), context_window / 2)`，取代固定的 2048。窗口决定阈值的模型因此更早压缩：200k 窗口从 197,952 提前到 175,000，没有窗口的条目从 125,952 提前到 112,000，32k 窗口从 30,720 提前到 24,576，262k 窗口从 256,000 提前到 229,376；窗口为 288,768 Token 及以上的不变。Web App 的上下文环随阈值移动。

## 输出流、Web App、CLI 与服务端

- `compaction_begin` 与 `compaction_end` 之间的输出流现在包括每个压缩请求的 `request_begin` / `request_end`、思考与文本，以及每个工具调用（执行的与被拒绝的）及其审批决定与输出。压缩 Prompt 与提醒行只写 Trace。新上下文开启时的 MCP 连接事件对与 `tool_list_ready` 排在 `compaction_end` 之后。
- Web App 的压缩行在「工作」节列出这些调用，被拒绝的调用是一张失败的工作卡。完整完成时「压缩结果」显示摘要。没有完整摘要的完成只有一种呈现：标题仍为「压缩完毕」，没有「压缩结果」节，状态图标改用 attention 色调，悬停提示说明新上下文改以 Trace 交接说明开头及其原因。`fatal` 收尾时写明未能开启新的上下文、保留当前上下文。
- 留给压缩的空间不足（`error_code` 为 `rejected` 或 `output_truncated`）时，悬停提示建议更正该模型的上下文窗口或调低压缩阈值，Provider 拒绝时附上其原话。被拒时输入区上方另有一条提示，附「打开 Agent 设置」，占据窗口提示的位置；关闭后或此后一次压缩以其他方式结束即消失。
- 交接了的被拒请求显示为一行「[已重试]」（模型服务拒绝了请求），没有错误横幅，Task 保持进行。`fatal` 收尾会收束仍在等待的重试行。`denied` 在 Web App 与 CLI 的重试行和错误行中有自己的原因措辞。
- CLI 的完成行后加注「(no full summary: a Trace hand-off note — <原因>)」，空间不足时其后接同样的建议；`fatal` 行写明保留当前上下文。
- 服务端把没有完整摘要的完成记为 `compaction_degraded`（expected），把因请求被拒而交接的记为 `context_refused`（expected，点名要更正的窗口），把 `fatal` 记为 `compaction_failed`（unexpected）。被拒的普通请求本身记为 `llm_retried`，不记 `llm_fatal`；`denied` 的请求记为 `llm_fatal`。压缩期间被 harness 拒绝的调用不再记为工具失败。
- 分叉时，摘要与交接说明中的交接文件路径（含被引调用参数里 JSON 转义的写法）与 Trace 路径改写为分叉自己的副本。

## 行为变化

- 窗口决定阈值的模型更早压缩，数值见「触发阈值」。
- 摘要失败的压缩不再结束运行，也不再保留原上下文等下次重试：对话在新上下文中继续，以交接说明开头。只有用户中断，或下一个上下文无法开启时，才保留当前上下文。
- 对话中途被以 HTTP 400、413、415 或 422 拒绝的请求不再让运行停止：上下文被交接，Task 照常继续。402、403 或 404 读作 `denied` 而非 `rejected`，也不再去掉图片后重发。
- 做了工具调用的压缩回复不再被判为无效：调用被应答或拒绝，压缩继续。
- `system_config.yaml` 损坏不再让运行在轮换时结束，新上下文沿用正在生效的配置开启。

## 内核与已存配置

- 内核版本前进到 `2026-11-12`，变动的是运行参数标签页：`compaction.max_rounds`、`compaction.reminder`、`compaction.handoff_note` 与新的 Prompt。未编辑过的运行参数标签页在下一次内核更新时前进，编辑过的保留。
- 已存的配置不迁移。配置中没有 `max_rounds`、`reminder` 或 `handoff_note` 时各自读作默认值，用户编辑过的 `prompt` 照原样使用。
