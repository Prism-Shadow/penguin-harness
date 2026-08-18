# 模型与 core：请求卫生、提示词守则与运行时设置

- **Date:** 2026-07-22
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `cli`, `model-catalog`
- **PR:** [#21](https://github.com/Prism-Shadow/penguin-harness/pull/21), [#24](https://github.com/Prism-Shadow/penguin-harness/pull/24), [#28](https://github.com/Prism-Shadow/penguin-harness/pull/28), [#38](https://github.com/Prism-Shadow/penguin-harness/pull/38), [#40](https://github.com/Prism-Shadow/penguin-harness/pull/40), [#43](https://github.com/Prism-Shadow/penguin-harness/pull/43)

[English](2026-07-22-models-and-core.md)

## 空工具列表不再上线

严格的 OpenAI 兼容服务端会拒绝携带 `tools: []` 的请求——vLLM 会回 `400 … tools must not be an empty array. Either provide at least one tool or omit the field entirely.`。Harness 发出的每一个不带工具的请求（模型页连通性探测、会话标题生成、视觉描述器）在对接本地 vLLM 端点时都撞上了这个问题。

- `buildUniConfig` 现在在工具列表为空时完全省略 `tools` 字段，而不是发送一个空数组。携带工具的 Agent 请求未变。
- `tool_choice` 已做端到端排查：本仓库与 AgentHub 0.4.0 都从不发送它。在 vLLM 上看到的 `400 "auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser` 失败，是服务端在收到非空 `tools` 数组而又没有这些启动参数时产生的——无论用哪个客户端，在 vLLM 上真正使用工具都需要这些参数（vllm skill 记录了这一点）。现在有一个线路层面的抓包测试固定住这两种行为：不带工具的请求既没有 `tools` 键，也没有 `tool_choice` 键。

## 默认系统提示词中的保留端口与 API key 守则

Agent 偶尔会通过杀掉监听进程来腾出一个被占用的端口——有时杀的是 Harness 自己的服务。默认服务端口现在只有一个来源：core 内部的 `ports.ts` 导出 `DEFAULT_SERVER_PORT`，经包出口做窄口径再导出，供 CLI 与 server 派生各自的默认值（运行时仍可通过 `--port` / `PORT` 覆盖）。提示词规则刻意不带任何硬编码数字：绝不杀死不是你启动的进程——包括 PenguinHarness 自己的服务；绝不把 Harness 服务的端口占为己用；当想要的端口被占用时，另选一个空闲端口，而不是杀掉监听者。

遇到 API 认证/授权或 API key 错误（401/403，key 无效或缺失）时，Agent 至多重试一次；若错误持续，就停止调用工具，并请用户在对话之外去 Agent 的 vault 或模型设置中更新 key——密钥值绝不属于对话内容。更新后的密钥只在下一次对话中生效，因此继续重试不可能成功——提示词把这一点写明了。

默认提示词是每个 Agent 可编辑的 `system_config.yaml` 的种子：已有 Agent 保留其当前提示词；新建 Agent 才会获得这些规则。

## 最大输出 Token 成为逐模型设置

一个本地部署、上下文为 32k 的模型会直接拒绝请求——`400 This model's maximum context length is 32768 tokens. However, you requested 32000 output tokens…`——并把会话标题生成一起带崩。模型页（以及 `penguin config model add --max-tokens`）现在接受逐模型的最大输出 Token 上限，存储在模型条目上，并优先于 Agent 级默认值生效；带外请求（标题生成、视觉描述）同样遵守它，取自身上限与模型上限中的较小者。不设置即维持当前行为。

## 思考等级移到对话层

思考等级不再是模型页上的一项标注。默认值仍在 Agent 设置中（它一直就在那里），而聊天草稿在模型选择器旁新增一个带标题的紧凑拾取器，提供 `low` / `medium` / `high` / `xhigh`——不再提供 `none`，因为许多模型无法关闭思考；不过它仍是合法的已存取值，也能正常显示。改动拾取器会立即写回 Agent 设置，因此发送时创建的 Session——以及之后的每一个——都使用新的等级。草稿的模型选择现在也以同样方式延续：一次成功发送之后，它就成为下一次对话的默认值。

## 子 Agent 跟随父 Session

`run_subagent` 在省略模型二元组时，此前会落到 Project 默认模型上，而子 Agent 总是以它自己所属 Agent 的思考等级运行。现在派生出的子 Agent 会继承父 Session 已解析的 `(provider, model_id)` 二元组及其生效的思考等级（工作区本就会继承）；工具调用中显式给出的完整二元组仍然优先，而半个二元组依旧被拒绝，不会用父级的另一半去补全。这个下传是三态的，因此没有设置思考等级的父级会产生同样没有等级的子级——子级自己的配置绝不会偷偷回流；而恢复一个 Session 时，会还原其 Trace 中记录的思考等级，而不是重新读取 Agent 配置。

## Session 携带自身来源

`session_meta` 新增一个可选的 `source` 字段（`"subagent" | "schedule"`，缺失即为用户创建），在创建时写入，跨恢复与压缩驱动的 trace 轮转均予保留，并被视作唯一事实来源：服务端从该 meta 派生会话索引中的来源（依转发来的 meta 注册子会话、收编发现的 trace、对由更早进程建立索引的行则惰性读取 trace 头部），数据库中不再存储该类型。

## AgentHub 0.4.1 与全部 Provider 分组的目录刷新

SDK 依赖升到 AgentHub 0.4.1（core 与 CLI）。这次升级是类型兼容的——已发布的 `UniConfig`、`ThinkingLevel`、消息/事件类型与 `AutoLLMClient` 声明相对 0.4.0 均未变化，因此 core 中无需任何适配。0.4.1 新增的内容都是增量的：一个 `listSupportedModels(currency)` 注册表（模型 / base URL / 客户端三元组，附模态、上下文窗口与每百万 Token 定价）、一个用于被拒绝的 `temperature` / `tool_choice` / `prompt_caching` 取值的类型化 `UnsupportedParameterError`，以及对 Gemini 3.6 世代、Kimi K3 与 GLM-5.2 的客户端支持。PenguinHarness 从不发送那三个参数，因此这个新错误今天不可能从这里触发。

那个注册表同时也是权威模型清单，因此目录被拿来与它逐项比对，并在所有落后之处做了刷新——条目从 59 个增加到 70 个。新增行：Google 端点与 OpenRouter 上的 Gemini 3.6 Flash 与 Gemini 3.5 Flash Lite；Anthropic 上的 Claude Fable 5 与 Claude Sonnet 5；Moonshot 上的 Kimi K3；OpenRouter 上的 Kimi K2.6、Qwen3.6 35B A3B 与 GLM 5.1；以及 SiliconFlow 上的 Kimi K2.6、GLM 5.1 与 Qwen3.6 35B A3B——最后这三个不带定价，因为没有任何来源公布它们的费率，而编一个数字比不写更糟。每一项上下文窗口、视觉标记与价格档位都来自注册表，而不是厂商页面。`google/gemini-3.5-flash` 的上下文窗口原为 1,000,000，与注册表以及原厂直连那一行的 1,048,576 不符，现已修正。新增 Kimi K3 还暴露出一个路由缺口：`resolveModelEnv` 只匹配 `kimi-k2.x`，因此这个新 id 在补上 `kimi-k3` 分支之前解析不到任何凭证对。

README 的模型表则朝相反方向调整——每个厂商系列只保留一行、且只列最新世代，完整的预置清单交给应用内的模型页。Kimi K2.6 与 Gemini 3.5 Flash 退出；按同一规则，Claude Opus 4.8 变为 Claude 5，GPT 5.5 变为 GPT 5.6。

## 会话标题生成转为内部实现

`session-title.ts` 移入 core 的 `internal/` 模块。`Session.generateTitle()` 仍是公开入口，`SessionTitleResult`、`stripConversationMarkers` 与 `sanitizeTitle`（后两者被服务端的兜底标题路径使用）仍可从包出口导入；而驱动 LLM 的内部实现（`buildTitlePrompt`、`generateTitleWithLLM`）不再属于公开接口。
