# 面向 AgentHub 0.4.2 的模型目录刷新

- **Date:** 2026-08-18
- **Type:** feature
- **Scope:** `model-catalog`, `core`, `web`, `cli`, `skills`
- **PR:** [#325](https://github.com/Prism-Shadow/penguin-harness/pull/325)
- **Issue:** [#313](https://github.com/Prism-Shadow/penguin-harness/issues/313)

[English](2026-08-18-model-catalog-refresh.md)

内置模型目录按 AgentHub 0.4.2 的模型阵容做了一次刷新：Gemini 3.7、GLM-5.3 与 GPT-5.6 系列进入各直连 Provider 分组，其 OpenRouter 对应条目同步加入；下架的免费条目被移除；DeepSeek 各条目按最新官方价目表重新定价；通用的 Chat Completions 客户端类型改名为 `openai-chat`。

## 新增预设

- **Gemini 3.7**——直连 Google 分组新增 `gemini-3.7-flash`：1,048,576 Token 上下文，支持视觉，每百万 Token $0.15 / $1.50 / $7.50（缓存读取 / 输入 / 输出），由 AgentHub 0.4.2 原生的 `gemini-3.7` 客户端提供服务。Google 的上线折扣在 2026-12-31 之前将上述费率减半，这里不予记录，遵循目录中直连条目一律按标价记录的惯例。
- **GLM-5.3**——直连 Z.AI 分组新增一个 1,000,000 Token 上下文、纯文本的条目，采用 Z.AI 公布的 $0.26 / $1.40 / $4.40，与 GLM-5.2 同价，由 AgentHub 0.4.2 统一的 GLM 客户端提供服务。
- **GPT-5.6**——直连 OpenAI 分组新增 `gpt-5.6`（裸 id 在上游路由到 sol 档，价格也按该档记录）、`gpt-5.6-terra` 与 `gpt-5.6-luna`，三者均为 1,050,000 Token 上下文并支持视觉，费率分别为 $0.50 / $5 / $30、$0.20 / $2 / $12 和 $0.02 / $0.20 / $1.20，由原生的 `gpt-5.6` 客户端提供服务。
- **OpenRouter 对应条目**——`google/gemini-3.7-flash` 按网关实际计费的折后价记录（$0.0375 / $0.375 / $1.875）、`z-ai/glm-5.3`（$0.26 / $1.40 / $4.40，网关对它没有折扣，因此与直连条目分毫不差）、`x-ai/grok-4.6`（$0.50 / $2 / $6，500K 上下文，支持视觉）以及 `deepseek/deepseek-v4-pro-0813`（$0.022 / $0.66 / $1.98，纯文本）。此前缺失的五个 OpenAI id——`openai/gpt-5.5-pro`、`openai/gpt-5.4`、`openai/gpt-5.4-mini`、`openai/gpt-5.4-nano` 与 `openai/gpt-5.4-pro`——一并补齐，于是每个直连 OpenAI 模型都有对应的 `openai/<id>` 网关条目，反之亦然；新增的测试固定了这一对应关系。所有费率都于 2026-08-18 从模型页面与按模型的 endpoints API 重新读取。

## 移除与重新定价

- OpenRouter 预设 `inclusionai/ling-3.0-flash:free` 在上游下架后被移除，免费模型文档列表也随之删去该项。
- 直连 DeepSeek 分组按 https://api-docs.deepseek.com/quick_start/pricing/ 更新后的官方价目表重新定价，记录的是**非高峰档**（公布价格中较低的一档）：`deepseek-v4-flash` 为每百万 Token ¥0.05 / ¥1.5 / ¥4.5，`deepseek-v4-pro` 为 ¥0.15 / ¥4.5 / ¥13.5（缓存命中 / 输入 / 输出）。高峰时段（北京时间 09:00–12:00 与 14:00–18:00）按双倍计费。
- 已经过期的 OpenRouter DeepSeek 条目在同一天重新读取：`deepseek/deepseek-v4-flash` $0.0168 / $0.0679 / $0.168，`deepseek/deepseek-v4-flash-0731` $0.0157 / $0.0786 / $0.1572，`deepseek/deepseek-v4-pro` $0.022 / $0.66 / $1.98。
- 这次重读同时修正了三个偏差达 2 倍的 OpenRouter GPT-5.6 条目：`openai/gpt-5.6-luna`（$0.02 / $0.25 / $1.20）与 `openai/gpt-5.6-terra`（$0.20 / $2.50 / $12）此前仍存着一个已经结束的促销价，而 `openai/gpt-5.6-sol`（$0.25 / $3.125 / $15）则新进入促销。网关条目记录的是 OpenRouter 实际计费的价格而非厂商标价，因此处在促销中的条目都注明了促销结束后应恢复的费率。

## OpenRouter 的 OpenAI 条目改走 Responses 协议

九个 `openai/*` OpenRouter 预设不再使用 `openai-chat`，改为固定 `client_type: "openai-responses"`，于是请求发往 `{base}/responses`，推理条目也得以完整往返，而不会被摊平。OpenRouter 在这些预设本就携带的同一个 `https://openrouter.ai/api/v1` base URL 上提供 Responses API，AgentHub 0.4.2 的 `openai-responses` 客户端正好能讲这套协议。

这项固定只限于 OpenAI 系列。Responses 客户端依赖 OpenAI 特有的推理条目语义——回放 `encrypted_content` / `signature` / `summary` 以及 assistant 的 `phase`——因此所有非 OpenAI 的 OpenRouter 条目（Anthropic、Google、DeepSeek、xAI、Z.AI、Moonshot、MiniMax、Qwen、各 `:free` 条目以及 Free Models Router）继续走 Chat Completions，另外四个网关也一样，它们本就不含 OpenAI id。两种协议读取的都是同一组 `OPENAI_API_KEY` / `OPENAI_BASE_URL`，因此凭证处理与环境变量回退保持不变；Web 的 base URL 提示会对这些条目显示 `/responses`。

新增的测试还固定了一条相关不变式：每个网关条目都必须显式携带 `client_type`。AgentHub 的路由是拿原始子串去匹配 `client_type || model_id`，从不检查 `base_url`，所以未固定的网关 id 会按自己的拼写被路由：`openai/gpt-5.6-sol` 会落到指向网关的第一方 GPT-5.6 客户端上，而带点号的 `anthropic/claude-opus-4.8` 会直接抛错。

## `openai-chat` 客户端类型

AgentHub 0.4.2 把通用的 Chat Completions 客户端改名为 `openai-chat`，裸 `openai` 保留为已废弃的别名。Harness 端全链路统一到这个规范名称：

- 所有网关预设——OpenRouter、Fireworks AI、SiliconFlow、Qwen Token Plan 与 Qwen Pay-As-You-Go——都固定 `client_type: "openai-chat"`，上文那些 OpenRouter `openai/*` 条目除外。CLI `model add` 的分组默认值与 Web 添加模型对话框同样产出 `openai-chat`。
- Web 的协议路径提示学会了 AgentHub 0.4.2 的通用协议客户端：`openai-responses` 对应 `/responses`，`ant-messages` 对应 `/v1/messages`，此前这两者都提示错了；`resolveModelEnv` 也能解析它们的环境变量回退（`OPENAI_*` / `ANTHROPIC_*`）以及 GPT-5.6 系列。

## 兼容性

这次改名不会破坏已存储的配置。新增的 core 辅助函数 `canonicalClientType` 会在读取时（core 配置加载，以及服务端的模型 GET、PUT 与 test-model 路径）和写入时（core 的 `addModel`）把 `openai` 这一拼写规范化，因此改名之前的 `.project_config.toml` 照常加载、照常运行，并在下一次保存时自动换成规范拼写。裸 `openai` 在 AgentHub 上游也仍然是可用的别名。

移除 Ling 预设同样不影响既有 Project：预设是在创建时复制进 `.project_config.toml` 的，此后没有任何机制会改写它们，而「同步预设」只会追加并更新目录所有的字段，不会删除。已经存有该条目的配置会保留它的上下文窗口、价格、视觉标记、base URL 与 API key——这些本来就存在配置里而不在目录中——所以丢失的只是目录提供的展示名，该条目回退为显示其上游 id，依旧可以选中、编辑，也依旧可以作为有效的默认模型。回归测试固定了这一点。

## 文档与 Skill

- `agenthub-models` skill（v12）把 model id 表同步到 AgentHub 0.4.2 的注册表——Gemini 3.7、GLM-5.3、GPT-5.4/5.5/5.6 的网关 id、`z-ai/glm-5.3`、MiniMax M3、Kimi K2.7 Code，以及新增的 DeepSeek 与 Claude 网关 id。其路由章节记录了 `openai-chat`、`openai-responses` 与 `ant-messages`，提醒网关 id 必须始终显式传入 `clientType`，并补充了 `fast_mode`（UniConfig）及其按客户端的支持矩阵。
- 中英文 `models` 与 `configuration` 文档页把 `client_type` 示例以及网关、本地端点相关的说明改用 `openai-chat`（并注明别名），点出 `openai-responses` 与 `ant-messages`，解释了 OpenRouter `openai/*` 固定 Responses 的做法，并提到了新增模型与 DeepSeek 非高峰计价的口径。
