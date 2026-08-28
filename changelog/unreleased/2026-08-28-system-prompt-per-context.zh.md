# 系统提示词按模型上下文重新组装

- **Date:** 2026-08-28
- **Type:** feature
- **Scope:** `core`, `docs`
- **PR:** [#539](https://github.com/Prism-Shadow/penguin-harness/pull/539)
- **Breaking:** yes — `SessionConfig.createLLM` / `ContextEngineDeps.createLLM`改为 `openContext`，返回新 LLM 连同该上下文的 `session_meta`

[English](2026-08-28-system-prompt-per-context.md)

压缩开启的新模型上下文，其系统提示词改为按此刻的 Agent State 组装，而不再沿用 Session
创建时的那份文本。旧上下文期间对 `AGENTS.md` 的修改——模型优化自己的指令，或用户在 Agent
设置里手改——在下一次压缩即生效，不必等下一个 Session。

## 细节

- `AGENTS.md`、已装 Skill 的元数据、Memory 索引、定时任务名单与环境字段中的日期在上下文开启时
  重新读取：Session 创建时、完成的压缩开启下一个上下文时、以及恢复时发现最新 Trace 文件已被完成
  的压缩收尾时（该上下文在此才第一次开启，因此取当前提示词；未关闭的上下文仍沿用记录的原文——
  注入其中的历史正是在那份文本下产生的）。
- 模板与功能开关仍按 Session 装载时的值（`system_config.yaml` 按 Session 固化，它同时决定工具集与
  压缩配置），vault 键名列表亦然——它列出的是本 Session 命令环境实际携带的键。
- 压缩轮转出的每个 Trace 文件都以记录该上下文实际所用提示词的 `session_meta` 开头；
  `Session.metaMessage` 随之更新。
- 上下文开启时 Agent State 读取失败，则沿用上一份提示词并打印一行警告——压缩已经成功，不因事后的
  读取失败而作废。
- `AgentState.agentsMd` 仍是装载时的快照；新增的 `readAgentsMd` 读取文件本身，`Agent.createSession`
  也改为读文件，因此跨修改被长期持有的 Agent 对象（例如自派生的子 Agent）不再用陈旧副本开启 Session。

## 兼容性

- SDK：`SessionConfig.createLLM` 与 `ContextEngineDeps.createLLM` 被
  `openContext(sessionTokens) => OpenedContext | Promise<OpenedContext>` 取代，`OpenedContext` 即
  `{ llm, sessionMeta? }`。直接构造 `Session` 或 `ContextEngine` 的代码，原先返回 LLM 的地方改为返回
  `{ llm }`；走 `Agent.createSession` / `resumeSession` 的代码无需改动。
- Trace：格式不变，无需迁移。Trace 文件的 `session_meta.system_prompt` 一直是该文件所属上下文实际
  所用的提示词；现在当 Agent State 在两次上下文之间发生变化时，同一 Session 的各文件会记录不同的
  值。把首个文件的提示词当作整个 Session 唯一提示词的读取方，应改为读取正在渲染的那个文件。
