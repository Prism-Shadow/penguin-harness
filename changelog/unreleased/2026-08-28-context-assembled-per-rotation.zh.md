# 每个模型上下文都按开启时的 Agent State 整体装配

- **Date:** 2026-08-28
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `cli`, `docs`
- **PR:** [#539](https://github.com/Prism-Shadow/penguin-harness/pull/539)
- **Breaking:** yes — SDK：`SessionConfig.createLLM` / `ContextEngineDeps.createLLM` 改为 `openContext`，移除 `RunOptions.thinkingLevel` 与子会话接缝上的逐轮思考等级；HTTP API：`POST /tasks` 与子会话消息不再接受 `thinkingLevel`，撤回跟进消息不再返回它

[English](2026-08-28-context-assembled-per-rotation.md)

压缩开启的新模型上下文，改为与新建 Session 的首个上下文完全相同地装配：Agent State 下的一切在此刻从磁盘
读取——整份 `system_config.yaml`（提示词模板及各节提示词与开关、内置工具条目与 MCP Server、压缩配置、
`max_turns`、模型默认参数）、`AGENTS.md`、vault、已装 Skill 的元数据、Memory 索引与定时任务名单。旧上下文
期间的修改——模型改自己的配置，或用户在 Agent 设置里手改——在下一次压缩即生效，不必等下一个 Session。运行参数
明确分为三层：**严格层**（系统提示词、工具集含 MCP、压缩配置、模型引用——请求前缀，一个 Trace 文件内逐字节
固定，提供商提示词缓存始终有效；vault 按同一轮换节奏更换）、**软限制层**（思考等级：允许中途更换、自下一次
请求生效，代价是提供商缓存失效——调节入口提醒建议先压缩）与**不限制层**（审批模式、工具 `r`/`rw` 权限、命令
策略：逐次决策读取、即刻生效）。

## 细节

- 三处开启以同一流程装配上下文：Session 创建、完成的压缩（summarize 与 discard 皆然）、以及恢复时发现最新
  Trace 文件已被完成的压缩收尾。恢复未关闭的上下文时沿用该文件记录的提示词与思考等级——注入的历史正是在该
  前缀下产生的——工具、Environment、vault 与运行参数一如既往取自当前 Agent State（Trace 不记录可执行配置）。
- 思考等级属软限制层：上下文以 Session 钉住的等级开启——Web 对话内选择器、CLI 的 `--thinking` / `/thinking`、
  SDK 新增的 `Session.pinThinkingLevel`——未钉住则取 Agent 配置的 `model.thinking_level`，并把**开启时**的等级
  记录为 `session_meta.thinking_level`（无等级记为 `"default"`）。重新钉住自下一次 LLM 请求即生效、允许中途更
  换；因为这会使提供商的缓存失效，调节入口在调节之前提醒建议先压缩（Web 选择器菜单脚注、CLI `/thinking` 回
  执）。压缩请求保持上下文自身的等级——其前缀必须逐字节不变。运行与 Task 请求都不携带等级。
- 不限制层逐次决策读取：审批模式此前已每次决策从 DB 重读；工具的 `r`/`rw` 权限现在每次查询都从磁盘上的
  Agent State 读取（`Session.toolPermission` 改为异步），命令策略每次审批从 `.project_config.toml` 读取——三者
  的修改对每个运行中 Session 的下一次工具调用即生效，无需轮换也无需重载。
- 随 Session 固定的只有：Session id、Workspace、模型条目（含凭据、窗口与逐模型标注）、来源、Project 的命令策略，
  以及 Environment 的进程宿主——后台命令、子会话及其监听器跨轮换存续。
- Environment 为新上下文重新装备（`Environment.reconfigure`）：vault 的值直接进入此后每条命令的子进程环境
  （已在运行的进程保留启动时的环境）。MCP 连接按配置缓存：条目未变的 Server 保持连接与已发现的工具——每轮压缩
  的 Session 不会每轮重启 Server——被删除或改动的关闭，只有新增、改动或上次失败的 Server 才连接，等待期间流式
  发出与首次运行相同的 `mcp_connect_begin` / `mcp_connect_end` 事件对（只列这些 Server），随后是新的
  `tool_list_ready`，由引擎实时推出。
- 压缩轮转出的每个 Trace 文件都以记录该上下文实际所用提示词与思考等级的 `session_meta` 开头，随后是连接事件
  对（如有）与工具集记录；`Session.metaMessage` 随运行中的上下文更新。
- 上下文开启时 Agent State 装配失败（例如 `system_config.yaml` 已无法解析）则本次运行以该错误结束、引擎保持
  旧上下文——与新建 Session 遇到的是同一个错误；不做静默回退。
- Agent State 装载收敛为一个函数：`loadAgentState`——带 `init` 即创建或装载入口（`createAgent` 与内置 Agent
  预置；`loadOrInitAgentState` 移除），不带 `init` 时 Agent 缺失即报错——上下文在会话中途开启时必须看到这个
  错误，而不是把已删除的 Agent 悄悄重建出来。`createSession` 与 `resumeSession` 因此同样从磁盘装载，跨修改被
  长期持有的 Agent 对象（例如自派生的子 Agent）不再用装载时的快照开启 Session。
- 上下文开启同样收敛为一个流程：首次运行的 bootstrap 与压缩后的 `openContext` 共用同一段实现（连接待连的
  Server、经 `emit` 发布连接事件对与工具集记录、构建 LLM），两条路径由同一个合并队列泵实时送出。
- 服务端不再因 vault 更新而重建该 Agent 已缓存的 Session 运行时：新值在运行中 Session 的下一次压缩后生效，与
  CLI 进程内 Session 的时机一致。智能体设置各页（提示词、运行参数、工具与 MCP、记忆、定时任务、vault、技能）、
  CLI 的 `config vault set/remove` 与对话内思考等级选择器都在修改处说明：新对话立即生效，进行中的对话在下一次
  压缩后生效。

## 兼容性

- SDK：`SessionConfig.createLLM` 与 `ContextEngineDeps.createLLM` 被
  `openContext(sessionTokens, { emit }) => OpenedContext | Promise<OpenedContext>` 取代，`OpenedContext` 即
  `{ llm, sessionMeta?, maxTurns?, compaction? }`；传给 `emit` 的记录在运行流上推出并写入轮转出的 Trace
  文件头部。直接构造 `Session` 或 `ContextEngine` 的代码，原先返回 LLM 的地方改为返回 `{ llm }`；走
  `Agent.createSession` / `resumeSession` 的代码无需改动。`Environment` 新增 `reconfigure({ toolConfig, vault })`
  与 `pendingMcpServerNames()`。
- SDK：`loadOrInitAgentState` 并入 `loadAgentState`——创建或装载行为改传 `init: {}`（或 `init: { preset }`）；
  不带 `init` 时 Agent 缺失即抛错。`SessionConfig.bootstrap` 改为接受 `{ emit }`、返回 `{ tools, llm }`（不再有
  `mcp` 字段），连接事件对与工具集记录经 `emit` 发布；`SessionConfig.mcpServers` 字段随之删除——要连什么由
  bootstrap 自己知道。
- SDK：移除 `RunOptions.thinkingLevel`、`SubagentHandle.run` 的 `thinkingLevel` 与
  `SubagentMessageOptions.thinkingLevel`；原先逐次运行改等级的宿主改用 `Session.pinThinkingLevel(level)` 钉住
  Session，自下一次 LLM 请求起生效（引擎经 `ContextEngineDeps.thinkingLevel` 读取实时钉住值）。
- SDK：`Session.toolPermission` 改为异步（逐次决策实时查询）；`SessionConfig.commandPolicy` 改为每次审批求值的
  来源函数，不再是静态配置；新增 `SessionConfig.toolPermission` 承载实时权限查询。
- HTTP API：`TaskCreateRequest.thinkingLevel` 与子会话消息的 `thinkingLevel` 不再读取（仍发送的客户端被忽略），
  `RecalledMessageResponse` 不再携带它。设置等级的方式是 `PATCH /sessions/:id { thinkingLevel }`，从该 Session
  的下一个模型上下文生效。
- Trace：格式不变，无需迁移。`session_meta` 新增 `thinking_level`；早于该字段的文件像新上下文一样解析等级。
  Trace 文件的 `session_meta.system_prompt` 一直是该文件所属上下文实际所用的提示词；现在当 Agent State 在两次
  上下文之间发生变化时，同一 Session 的各文件会记录不同的值，且轮转出的文件头部在 `tool_list_ready` 之前多出
  该上下文的连接事件对。把首个文件的提示词或工具集当作整个 Session 唯一一份的读取方，应改为读取正在渲染的那个
  文件。
