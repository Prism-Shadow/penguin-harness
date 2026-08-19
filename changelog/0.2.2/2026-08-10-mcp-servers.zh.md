# MCP Server 支持：stdio、Streamable HTTP 与 SSE 传输

- **Date:** 2026-08-10
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `cli`, `docs`
- **PR:** [#242](https://github.com/Prism-Shadow/penguin-harness/pull/242)
- **Issue:** [#229](https://github.com/Prism-Shadow/penguin-harness/issues/229), [#239](https://github.com/Prism-Shadow/penguin-harness/issues/239)
- **Breaking:** yes — 拆分之前的 Trace 中内嵌的工具记录不再被读取或展示。

[English](2026-08-10-mcp-servers.md)

`system_config.yaml` 中的 `tools.mcpServers`——此前一直是一个预留的空接缝——现已接上一个真正的 MCP（Model Context Protocol）客户端，基于官方 TypeScript SDK v2（`@modelcontextprotocol/client` 2.0.0，规范修订版 2026-07-28）。每个条目保持规范的 `{ name, config }` 形状；`config` 描述三种传输之一（[#242](https://github.com/Prism-Shadow/penguin-harness/pull/242)，关闭 [#239](https://github.com/Prism-Shadow/penguin-harness/issues/239) 与 [#229](https://github.com/Prism-Shadow/penguin-harness/issues/229)）：

- `stdio`——派生一个本地服务进程（`command` / `args` / `env` / `cwd`）；
- `http`——Streamable HTTP，即当前规范的远程传输（`url` / `headers`）；
- `sse`——面向尚未迁移的服务的旧版 HTTP+SSE 传输（`url` / `headers`）。

`transport` 在可推断时可以省略（`command` → stdio，`url` → http）；`sse` 必须显式写出。各条目共用可选的 `connectTimeoutMs`（连接 + 发现的预算，默认 10 秒）以及施加于该服务每个工具的 `timeoutMs` / `maxOutputLength` 约束。

## 行为

- 首次 `listTools()`（Session 组装时）会并行连接所有服务并发现一次工具；结果是一份 Session 生命周期内的快照（`tools/list_changed` 被忽略）。无效条目与不可达的服务会被跳过并给出 stderr 警告——Session 创建绝不被阻塞。
- 被发现的工具以 `mcp__<server>__<tool>` 加入扁平的工具命名空间，并原样经既有的 Environment 执行契约运行：分帧、逐工具超时、前端截断、中断与审批流程全部适用。
- 只读审批模式：被服务标注 `readOnlyHint: true` 的工具映射为权限 `r`；其余为 `rw`（标注属于不可信的提示，因此默认取更严格的方向）。
- stdio 服务进程看到的是 SDK 那份安全的继承环境，加上该条目自己的 `env`——Agent 的 vault 刻意**不**注入 MCP 服务进程（与命令子进程不同）；某个服务需要的变量必须列在它自己的条目里。`cwd` 默认为 Session 的 Workspace。`Environment.dispose()` 会关闭每一个客户端，包括 stdio 的子进程。
- 结果的映射方式为：文本块 → 输出文本；图像块 → data-URL 图像；音频与二进制资源 → 占位行；`structuredContent` 仅在不存在文本块时才序列化；服务报告的 `isError` 落为 `stop_reason: "failed"`。

## Web App

Agent 设置页的 Tools 标签把 MCP Servers 区块从一份只读的 JSON 转储变成 vault 式的管理：一张已配置服务的表格，加上一个新增/编辑表单——顶部是传输方式的标签页（默认 http——url / headers；stdio：command / args / env / cwd；共用的预算字段预填其生效默认值），删除置于确认之后，且立即持久化——条目中未知的配置键在编辑后仍得以保留。连通性测试与模型页对齐：表单中一个独立的「测试连接」按钮会经新的 `POST …/config/mcp-test` 路由探测当前取值（服务端连接 + 工具发现，什么都不保存；结果以 toast 给出工具数量与延迟），而小节级的按钮会在确认对话框之后依次测试每一个已配置的服务，并在每一行落上一个带色调的结果徽章。服务端的 PUT 现在会经 core 的传输解析器逐条校验，并做重名检查，因此一个损坏的条目会在保存时以精确的 400 被拒绝，而不是等到下次 Session 启动时才被警告并跳过。

## 可见的连接阶段 + 协议拆分（破坏性）

Session 创建不再阻塞于 MCP 连接——此前首次发送会在服务连接期间无声地卡住。工具集现在在首次运行开始时惰性解析，并以协议形式流出：

- `session_meta` **丢弃其 `tools` 字段**；完整的 schema 在发现完成之后作为新的 `tool_list_ready` 事件随之而来，并在每个压缩后的 Trace 文件中紧挨 meta 重写一次。**与拆分之前的 Trace 明确不兼容**（刻意为之，未保留任何兼容代码）：它们内嵌的工具记录不再被读取或展示——旧 Trace 的其他一切照常渲染，也无需任何操作。
- 连接 + 发现的等待由一对 `mcp_connect_begin` / `mcp_connect_end` 括起——结束事件携带一个压缩风格的整体 `status`（completed / failed / aborted）以及逐服务的结果（各服务并行连接；墙钟时间即这对事件的时间戳之差）。在 Trace 中，这一对事件与 `tool_list_ready` 落在该次运行的输入之后、位于新的这一轮之内——包括被恢复会话的重连。Web 聊天把这个阶段渲染为一个统一的步骤行（复用「推理与工具」分组头部的外壳，含粘性标题栏，与压缩行共用）：运行中/成功/失败保持同一形态，已结算的行以发现到的工具数量领起并点名不可用的服务，展开后每个服务一组——状态、工具数量与该服务的连接耗时——各自可再展开为它的工具列表或失败详情；CLI 打印成对的 `[mcp]` 行（失败原因内联在结束行上）；分析时间线把「mcp connect」渲染为一段位于它自己的「其他」图例类别下的跨度（而非一次工具执行）。在连接中途中止会取消该次尝试——下次发送会重连；而继续同一个对话绝不会重连（引擎跨 Task 存活）。被中止的那一轮会被记录下来：Session 自身把输入、被中止的连接事件对与中止事件写入 Trace（分析页会显示这次打断；刷新或重启后该消息仍在），而那份输入会带进下一次发送，而不是被丢弃。Trace 事件行把工具参数 schema 渲染为一张属性表，而不是原始 JSON。
- 凭证校验仍留在 Session 创建时刻（服务端的 `model_credential_missing` 400 予以保留）；被恢复的会话也不再阻塞于 MCP，代价是 trace 损坏类错误会在首次运行时浮现，而不是在恢复时。

已有配置不受影响：`mcpServers` 默认为 `[]`，而其内层的 `config` 对象此前从未被解释，因此没有任何已存形态发生改变，也不涉及迁移。文档：tools、configuration、interfaces、web-app 与 omni-message 五个页面（中英）记录了该 schema、事件与语义。

## 兼容性

`session_meta` 不再携带 `tools`；schema 改由独立的 `tool_list_ready` 事件送达。在拆分之前写入的 Trace 在磁盘上仍保有其内嵌的工具记录，但已没有任何东西读取或展示它——这类 Trace 的其他一切照常渲染。不涉及迁移，用户也无需任何操作；针对旧形态没有保留任何兼容代码。已存的 `mcpServers` 配置不受影响：该字段默认为 `[]`，其内层 `config` 对象此前从未被解释。
