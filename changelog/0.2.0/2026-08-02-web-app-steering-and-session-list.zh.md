# 转向能在刷新后存活并携带文件；会话列表可扩展

- **Date:** 2026-08-02
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#156](https://github.com/Prism-Shadow/penguin-harness/pull/156), [#157](https://github.com/Prism-Shadow/penguin-harness/pull/157), [#158](https://github.com/Prism-Shadow/penguin-harness/pull/158)
- **Issue:** [#136](https://github.com/Prism-Shadow/penguin-harness/issues/136), [#137](https://github.com/Prism-Shadow/penguin-harness/issues/137), [#139](https://github.com/Prism-Shadow/penguin-harness/issues/139), [#140](https://github.com/Prism-Shadow/penguin-harness/issues/140)

[English](2026-08-02-web-app-steering-and-session-list.md)

转向消息不再在刷新时消失、也不再以容易产生重复的草稿形式回来；文件附件能像图片一样转向；工具卡片副标题在参数流式输出期间不再抖动；而侧边栏在面对大量 Agent、Workspace 与 CLI 会话时仍然快速可读。

## 跨刷新的转向，且内容可见（[#136](https://github.com/Prism-Shadow/penguin-harness/issues/136)、[#140](https://github.com/Prism-Shadow/penguin-harness/issues/140)）

- 服务端现在为每个运行中的会话镜像其尚未投递的转向队列（文本加上图片/文件数量），并在每个 `task_state` 事件与 SSE 订阅快照上广播它。输入区的「转向已排队」提示会显示每条排队消息的内容，并能在刷新后存活；条目会在其 `[user_steering]` 消息进入流时退场，而该镜像在运行退出时丢弃。
- 一次成功的转向会像普通发送那样丢弃 localStorage 草稿——此前已发送的文本会在刷新时作为草稿复活，重新发送它就产生了重复的转向消息。草稿丢弃同时清空文本引用，因此稍后的 Skill/芯片刷新不可能把已发送的文本带回来。
- 文件附件现在完全像图片一样搭乘转向：按任务附件规则写入会话草稿区，并作为 `[attached file: <path>]` 行投递在转向文本上。只有文件的草稿会转向，而不是带着另一条通道的提示无声地落进后续队列；一次 409 会把已写入的文件清理掉。
- 新增 e2e 用例：在一次缓慢的工具运行期间转向 → 刷新 → 看到带内容的提示、空的输入区，以及恰好一次的投递。

## 工具卡片副标题一次成型地渲染（[#137](https://github.com/Prism-Shadow/penguin-harness/issues/137)）

折叠工具行的副标题（模型撰写的调用描述，或缩短后的文件路径）不再在每个流式片段上重新渲染——一段不断增长的描述会让头部的 flex 行以每秒约 8 次的频率重新求解，而对一个仍在增长的路径调用 `shortenPath` 又会非单调地改写它。现在某个字段只有在它的收尾引号到达之后才渲染（当参数流式输出稳定时该闸门放行，因此被中止的调用仍会显示它已有的内容），而当用户编辑过的 schema 在文件工具上启用了描述时，完整描述优先于文件路径——这正是 CLI 早已采用的规则。

## 会话列表：默认由数据库提供，CLI 会话按需开启，分组分页（[#139](https://github.com/Prism-Shadow/penguin-harness/issues/139)）

- 会话索引新增仅存在于数据库中的 `client`（'web' / 'cli'；NULL 表示旧记录，按 web 处理）与 `has_trace` 两列；已有的 `web.db` 文件在打开时由一个幂等的 ALTER 守卫就地升级。
- 默认列表直接从数据库提供 web 会话（在新索引下由 SQL 排序），稳定状态下不再扫描 Trace 目录；`cli=1` 才选择启用 Trace 发现与收编，而被收编的 CLI 行仍排除在默认列表之外，同时可以单独到达（深链）。
- 侧边栏用户菜单新增逐用户的「显示 CLI 会话」开关（默认关闭），持久化在 `ui_prefs` 中；切换它会在新的过滤条件下重新拉取列表。
- 两种侧边栏分组模式都对分组本身分页：初始 10 个分组，「更多分组（N）」再展开 10 个——这是纯粹的渲染上限，按 Project 重置，并在切换模式时重置。
