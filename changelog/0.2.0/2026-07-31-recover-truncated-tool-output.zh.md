# Core：被截断的工具输出在其 Session 内仍可恢复

- **Date:** 2026-07-31
- **Type:** feature
- **Scope:** `core`, `web`
- **PR:** [#145](https://github.com/Prism-Shadow/penguin-harness/pull/145)

[English](2026-07-31-recover-truncated-tool-output.md)

工具输出仍然精确遵守每个条目的 `maxOutputLength`，与此前完全一致：Web/CLI 流、完整的 `tool_call_output`、Trace 与下一次模型输入依旧逐字节对齐，截断标记与终止标记仍位于上限之外。

当 Agent Session 中的某次工具调用确实超出该上限时，Environment 现在还会把它收到的文本存入 Session 草稿区（`scratchpad/<sessionId>/truncated-tool-output/`，仅在真正发生截断时创建，在支持的平台上使用私有权限），并把恢复路径追加到前端与模型看到的同一份工具结果上。不新增任何面向模型的工具或 schema：模型用既有的 `read_file`（`offset`/`limit`）或有针对性的 `rg`/`tail` 命令去查看该文件。

接线是一个通用的 Environment 参数，而不是一个特性专用的管理器：`EnvironmentConfig.sessionScratchpadDir` 指明 Session 作用域的存储根目录，Environment 在内部由它派生出 `truncated-tool-output/`，而新的 `sessionScratchpadDir()` 路径助手成为 `scratchpad/<sessionId>` 的唯一定义（输入图片与目标文件本就在那里，现在也由同一个助手派生）。Agent 组装会自动传入它；独立的 SDK 嵌入方省略它即保持此前只截断的行为，或者通过传入一个目录来选择加入——没有任何归档类跨越公开配置接口。

对模型可见的路径是一个普通的绝对路径，且始终是该注记的最后一个元素——而路径写法规则现在覆盖 core 为模型组装的每一个路径，统一经由从包出口导出的一个 `modelVisiblePath` 助手：系统提示词的 App Data Dir 与 CWD 行、`[attached image: …]` 行、服务端的 `[attached file: …]` 行，以及目标文件那一行。在 Windows 上该写法使用正斜杠：`exec_command` 经（Git）Bash 运行，而 Node 的 fs API 也接受正斜杠，因此模型可以把同样的写法原样再发进 JSON 工具参数与 shell 命令中，而不会出现反斜杠转义错误；Harness 的路径都是普通绝对路径（绝不带 `\\?\` 前缀），因此这次替换是无损的，而 POSIX 路径原样通过。

文件工具在消费侧仍与 Windows 写法兼容：`path.resolve` 同样接受 `C:\…` 与 `C:/…`（由仅在 win32 运行的测试固定），工具消息回显调用方自己的写法，而工具输出中唯一一处由系统组装的路径——`read_file` 的「未找到」工作区提示——也使用对模型可见的写法。Web App 的文件卡片随之调整：此前剥离工作区前缀要求助手所用的分隔符与 Workspace 的完全一致，因此在 Windows 工作区上，正斜杠写法压根产生不了卡片；它现在把两侧都按 `/` 比较，并对盘符不区分大小写，而 POSIX 工作区仍然绝不触碰反斜杠（在那里它是合法的文件名字符）。

每次调用至多归档 8 MiB——比 `read_file` 的 8 MiB 扫描上限少一个字节，好让该工具最后那次零字节读取仍能确认文件结束。更大的调用则保留 UTF-8 安全的头尾窗口，中间以显式的 `[archive middle truncated]` 空缺标出。捕获内存是有界的（精确阶段用 Buffer 块，晋升之后用固定容量的环形尾缓冲），跨流增量被切开的代理对会被重新拼合；而这只是逐次调用的上限：Session 没有归档总量配额。恢复保留的是 Environment 收到的内容；产出方在上游就已丢弃的文本（例如来自有界未读缓冲的 `[..., N chars of earlier output dropped ...]` 标记）无法恢复。

恢复文件包含未脱敏的工具文本，与 Session 草稿区同生共死——既有的显式 Session 删除路径会移除它们，不新增独立的清理生命周期，而这可能会延长意外读入的敏感数据在本地静态留存的时间。Trace 存储的是同一份被截断的结果与那个绝对路径，而不是归档字节的第二份副本。归档写入失败绝不改变该工具的 `stop_reason`；可见的注记与 stderr 警告只携带一个简短的 errno 码，不带路径或原始错误。
