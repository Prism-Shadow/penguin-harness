# 压缩在给出摘要之前先写交接文件

- **Date:** 2026-11-04
- **Type:** feature
- **Scope:** `core`, `amsp`, `server`, `web`, `docs`

[English](2026-11-04-compaction-handoff-files.md)

`summarize` 压缩现在可以在给出摘要之前先走至多 `compaction.max_rounds` 个工具轮（默认 3）。新的默认压缩 Prompt 要求模型把篇幅超过一段的细节（计划、发现、决定记录、草稿）写成本 Session scratchpad 下 `<scratchpad>/handoff/` 里的文件，再按固定小节给出摘要：请求、决定与约束、进展、错误与修正、文件、下一步。交给下一个上下文的摘要末尾附上被压缩上下文的 Trace 文件路径，以及按行精确查询它的方法。

## 细节

- 工具轮中模型可以调用 `read_file`，以及绝对路径位于本 Session scratchpad 内的 `write_file` / `edit_file`。其余调用以 `fatal` 的 `[tool error]` 应答并说明允许什么，既不执行也不询问。放行的调用与其他调用一样遵循 Session 的审批模式：`always-ask` 下用户逐个批准交接文件的写入，Web App 中在压缩行的「工作」节里操作。
- 一轮的输出就是下一请求的全部输入，仍发在同一个模型对象上，因此每个请求都延续已缓存的前缀。每轮按缓存读价重读整个上下文：250k 的上下文走三轮，每次压缩约多出 0.75 M 缓存读 Token。`max_rounds: 0` 恢复单次纯文本请求及其开销。
- 工具轮不计入 5 次的重试预算；轮数用尽后，含工具调用的响应照旧被判为无效。
- `[context_summary]` 块末尾附一段简短的尾注：被压缩的 Trace 文件路径、更早的文件在哪里，以及查询指引——先列出匹配行的行号（`rg -n -o` / `grep -n -o`，PowerShell 下为 `Select-String … .LineNumber`，按 Session 的 shell 措辞），再用 `read_file` 的 `offset` / `limit` 只读这些行，绝不读整个文件。模型切换的 Trace 交接说明（`[model_switch_from]`）给出同样的指引。
- `compaction_begin` 与 `compaction_end` 之间的输出流现在还包括每个压缩请求的 `request_begin` / `request_end`，以及工具轮的工具调用、审批决定与输出。压缩 Prompt、被判无效响应的配对修复与纠正说明仍只写 Trace。
- Web App 的压缩行在「工作」节中逐条列出工具轮，每个调用一行工具行；「压缩结果」只显示最后一个请求的文本。CLI 不打印任何新内容。
- 恢复时从收尾区间内最后一个已完成的请求取摘要，并按文件自身的路径重建尾注。分叉时把摘要中的交接文件路径与尾注的 Trace 路径改写为分叉自己的副本。
- 内核版本前进到 `2026-11-04`，变动的是运行参数标签页（`compaction.max_rounds` 与新的 Prompt）。存量 Agent 在内核更新之前沿用已存的 Prompt；它们的配置里没有 `max_rounds`，按 3 读取。
