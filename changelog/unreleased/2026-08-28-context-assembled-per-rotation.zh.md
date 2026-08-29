# 每个模型上下文都按开启时的 Agent State 整体装配

- **Date:** 2026-08-28
- **Type:** feature
- **Scope:** `core`, `cli`, `docs`
- **PR:** [#539](https://github.com/Prism-Shadow/penguin-harness/pull/539)
- **Breaking:** yes — `SessionConfig.createLLM` / `ContextEngineDeps.createLLM` 改为 `openContext`：返回新 LLM 连同该上下文的 `session_meta` 与引擎参数，并经 `opts.emit` 发布其记录

[English](2026-08-28-context-assembled-per-rotation.md)

压缩开启的新模型上下文，改为与新建 Session 的首个上下文完全相同地装配：Agent State 下的一切在此刻从磁盘
读取——整份 `system_config.yaml`（提示词模板及各节提示词与开关、内置工具条目与 MCP Server、压缩配置、
`max_turns`、模型默认参数）、`AGENTS.md`、vault、已装 Skill 的元数据、Memory 索引与定时任务名单。旧上下文
期间的修改——模型改自己的配置，或用户在 Agent 设置里手改——在下一次压缩即生效，不必等下一个 Session，也绝不
会作用于正在运行的上下文：一个上下文的提示词、工具集与 vault 自开启起固定到关闭。

## 细节

- 三处开启以同一流程装配上下文：Session 创建、完成的压缩（summarize 与 discard 皆然）、以及恢复时发现最新
  Trace 文件已被完成的压缩收尾。恢复未关闭的上下文时沿用该文件记录的提示词——注入的历史正是在它之下产生
  的——工具、Environment、vault 与运行参数一如既往取自当前 Agent State（Trace 不记录可执行配置）。
- 随 Session 固定的只有：Session id、Workspace、模型条目（含凭据、窗口与逐模型标注）、来源、显式钉住的思考
  等级、Project 的命令策略，以及 Environment 的进程宿主——后台命令、子会话及其监听器跨轮换存续。
- Environment 为新上下文重新装备（`Environment.reconfigure`）：vault 的值直接进入此后每条命令的子进程环境
  （已在运行的进程保留启动时的环境），MCP Server 按新配置重新连接——等待期间流式发出与首次运行相同的
  `mcp_connect_begin` / `mcp_connect_end` 事件对，随后是新的 `tool_list_ready`，由引擎实时推出。
- 压缩轮转出的每个 Trace 文件都以记录该上下文实际所用提示词的 `session_meta` 开头，随后是连接事件对（如有）
  与工具集记录；`Session.metaMessage` 随运行中的上下文更新。
- 上下文开启时 Agent State 读取失败（例如配置文件已无法解析），则整体沿用上一个上下文的配置并打印一行警告
  ——压缩已经成功，不因事后的读取失败而作废。
- `createSession` 与 `resumeSession` 同样从磁盘装载 Agent State（新增 `loadAgentState`），因此跨修改被长期
  持有的 Agent 对象（例如自派生的子 Agent）不再用装载时的快照开启 Session。

## 兼容性

- SDK：`SessionConfig.createLLM` 与 `ContextEngineDeps.createLLM` 被
  `openContext(sessionTokens, { emit }) => OpenedContext | Promise<OpenedContext>` 取代，`OpenedContext` 即
  `{ llm, sessionMeta?, maxTurns?, compaction? }`；传给 `emit` 的记录在运行流上推出并写入轮转出的 Trace
  文件头部。直接构造 `Session` 或 `ContextEngine` 的代码，原先返回 LLM 的地方改为返回 `{ llm }`；走
  `Agent.createSession` / `resumeSession` 的代码无需改动。`Environment` 新增 `reconfigure({ toolConfig, vault })`。
- Trace：格式不变，无需迁移。Trace 文件的 `session_meta.system_prompt` 一直是该文件所属上下文实际所用的提示
  词；现在当 Agent State 在两次上下文之间发生变化时，同一 Session 的各文件会记录不同的值，且轮转出的文件头部
  在 `tool_list_ready` 之前多出该上下文的连接事件对。把首个文件的提示词或工具集当作整个 Session 唯一一份的
  读取方，应改为读取正在渲染的那个文件。
