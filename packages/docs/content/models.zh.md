---
title: 模型与 Provider
description: 经 AgentHub 单一网关接入模型，以 (provider, model_id) 成对标识，Project 级模型表、凭证与思考等级配置。
---

## 单一网关

所有模型访问都经由一个网关库：`@prismshadow/agenthub`(AutoLLMClient)。core 只定义一层很薄的 `LLMInterface`(见 [接口契约](/interfaces))，各 Provider 的协议适配全部由 AgentHub 完成，因此可以接入 1000+ 在线或本地模型，包括任意 OpenAI 兼容端点。协议翻译实现在 `packages/core/src/llm/generative-model.ts`。

## 模型标识

模型身份永远是 `(provider, model_id)` 成对表示：`provider` 是配置分组名，`model_id` 是原样发给上游的请求 id。二者是两个独立字段，任何环节都不允许拼接成一个字符串。

所有涉及模型的接口都要求完整的二元组：CLI、HTTP API 与 SDK 都会拒绝半个引用，而不会替你补全。provider 绝不由模型 id 推断，也没有缺省值——网关会以上游 id 转售厂商模型，猜出来的分组会把该条目的凭据发往无人指定的厂商。凡是模型引用本身可省略之处（`penguin run` / `chat`、创建 Session、定时任务），可选的是整对：两半都省略即使用 Project 默认模型。

## Project 模型表

每个 Project 的可用模型记录在隐藏文件 `.project_config.toml` 中，由 CLI(`penguin config model add / default / list`，见 [CLI 参考](/cli))或 Web 界面维护，不手工编辑。`ModelEntry` 字段：

| 字段 | 说明 |
| --- | --- |
| `provider` | 配置分组名，与 `model_id` 成对构成唯一键 |
| `model_id` | 上游请求 id |
| `context_window` | 上下文窗口（Token 数）。不只用于展示：每次请求的实际输出上限与压缩阈值都由它推导，请求不会索要超出窗口剩余空间的输出。缺省（或小于 4096 的非常规值）时输出收敛关闭、压缩按 128000 假定推导——窗口更小的模型务必填真实值 |
| `max_tokens` | 可选的按模型输出上限（单次请求最大输出 Token 数）。设置后覆盖 Agent 的 `model.max_tokens`，缺省沿用。该值是天花板而非逐字上线值：每次请求实际发送 `min(max_tokens, context_window − 估算输入 − 安全余量)`，小窗口模型无需手工调低。Web 整表保存时省略该字段即清除 |
| `client_type` | 协议提示(如 `openai`)；缺省由 AgentHub 按 model id 推断 |
| `display_name` | 显示名 |
| `vision` | 是否支持图像输入，默认 true |
| `fast_mode` | 可选的快速模式（默认关闭）：让该模型的会话请求进入厂商的快速推理档位，按溢价计费。只会持久化 `true`——Web 整表保存时省略该字段即清除。没有 fast 档位的模型会拒绝携带该参数的请求（见 [快速模式](#快速模式)） |
| `pricing` | 三档价格(单位 `usd_per_mtok`,USD 每百万 Token):`cache_read` / `cache_write` / `output` |
| `api_key` / `base_url` | 内联凭证，可留空；留空时 AgentHub 回退读环境变量 |

新建 Project 的默认模型是 deepseek-v4-flash。另可配置一条 `vision_model`，作为 text-only 模型使用 `describe_image` 时的代读模型(见 [工具与审批](/tools))；默认不配置。

文件形态(示意):

```toml
default_model = { provider = "deepseek", model_id = "deepseek-v4-flash" }
vision_model = { provider = "google", model_id = "gemini-3.1-pro-preview" }

[[models]]
provider = "deepseek"
model_id = "deepseek-v4-flash"
context_window = 1000000

[[models]]
provider = "custom"
model_id = "my-model"
client_type = "openai"
base_url = "https://llm.example.com/v1"
api_key = "sk-..."
```

对标注 `vision = false` 的模型(如 DeepSeek 系列)：对话输入中的图片会保存到 Session scratchpad，以文件路径形式拼入文本；读图工具切换为 `describe_image`。

## 内置 Provider 分组

内置分组及其环境变量回退(目录源：`packages/core/src/state/model-catalog.ts`)；每个分组同时存在 `_BASE_URL` 变体(如 `ANTHROPIC_BASE_URL`):

| Provider | API Key 环境变量 | 说明 |
| --- | --- | --- |
| deepseek | `DEEPSEEK_API_KEY` | 默认模型所在分组 |
| openrouter | `OPENAI_API_KEY` | OpenAI 兼容网关，预置 base URL `https://openrouter.ai/api/v1` |
| fireworks | `OPENAI_API_KEY` | Fireworks AI(OpenAI 兼容)，预置 base URL `https://api.fireworks.ai/inference/v1`；API 模型 id 形如 `accounts/fireworks/models/<slug>` |
| siliconflow | `OPENAI_API_KEY` | OpenAI 兼容网关，预置 base URL `https://api.siliconflow.cn/v1` |
| qwen-token-plan | `OPENAI_API_KEY` | Qwen Token Plan 订阅网关，预置 base URL `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`；定价取各模型页官方牌价(预览模型仅配额倍率促销、无牌价) |
| qwen-pay-as-you-go | `OPENAI_API_KEY` | Qwen 按量付费(DashScope OpenAI 兼容端)，预置 base URL `https://dashscope.aliyuncs.com/compatible-mode/v1`；转售第三方模型保留厂商前缀 id(如 `kimi/kimi-k3`) |
| google | `GEMINI_API_KEY` | |
| anthropic | `ANTHROPIC_API_KEY` | |
| openai | `OPENAI_API_KEY` | |
| zhipu | `ZAI_API_KEY` | |
| moonshot | `MOONSHOT_API_KEY` | |
| minimax | `MINIMAX_API_KEY` | 直连 MiniMax M3 Responses 客户端（`client_type = "minimax-m3"`）：`MiniMax-M3` 支持 1,000,000 Token 上下文和视觉输入；预置 base URL `https://api.minimax.io/v1`；接受 Token Plan Subscription Key 或按量付费 API Key |
| custom | `OPENAI_API_KEY` | 任意 OpenAI 协议端点 |

网关分组(openrouter / fireworks / siliconflow / qwen-token-plan / qwen-pay-as-you-go)经 AgentHub 的 OpenAI 客户端请求，因此凭证留空时读取的是 `OPENAI_API_KEY`，而非网关自己的变量名。直连 MiniMax M3 客户端读取 `MINIMAX_API_KEY`。内置 MiniMax 预设固定使用 `https://api.minimax.io/v1`；仅当模型条目未内联 `base_url` 时才读取 `MINIMAX_BASE_URL`。M3 价格取 MiniMax 按量付费的标准档、输入不超过 512K Token 的牌价；超过 512K 后各档价格翻倍，priority 档另为 1.5 倍，因此长上下文与 priority 用量会被低估——与 OpenAI(>272K)、Gemini 3.1 Pro(>200K)沿用的基准档口径一致。

预置目录还收录了 OpenRouter 的免费档：`:free` 模型变体(如 `inclusionai/ling-3.0-flash:free`、`nvidia/nemotron-3-ultra-550b-a55b:free`)与统一路由 `openrouter/free`(Free Models Router)，零成本可用，但受 OpenRouter 免费档速率限制与数据政策约束。

预置目录中的部分模型：deepseek-v4-pro / deepseek-v4-flash、MiniMax-M3、gemini-3.1-pro-preview、claude-opus-4-8 / claude-sonnet-4-6、gpt-5.5、glm-5.2、kimi-k2.6、qwen3.8-max 等(非完整清单)。

## 本地 / 自建 OpenAI 兼容端点（如 vLLM）

本地推理服务就是一条 `custom` 条目：`client_type = "openai"`、`base_url` 指向服务地址（如 `http://127.0.0.1:8000/v1`）、`model_id` 填服务端的模型名。两处设置决定运行是否顺畅：

- **服务端要开启工具调用。** vLLM 需以 `--enable-auto-tool-choice` 启动，并按模型选择对应的 `--tool-call-parser`（如 Qwen 用 `hermes`、Llama 3.x 用 `llama3_json`）；不开启时工具调用会以纯文本返回，Agent 循环无法执行任何工具。
- **条目的 `context_window` 填服务端的真实窗口**——vLLM 即 `--max-model-len` 的值（如 `32768`）。每次请求的输出上限与压缩阈值都会由该窗口自动推导：请求把 `max_tokens` 收敛到窗口剩余空间以内，压缩也会在撞上窗口硬限制之前触发，无需手工调低 `max_tokens`。不填时不做逐请求输出收敛、压缩按 128000 假定，真实窗口更小会导致请求被拒。

## 思考等级

对于 MiniMax M3，`none` 会直接映射为 `reasoning.effort = "none"`。

思考等级共五档：`none | low | medium | high | xhigh`，按 Agent 在 `system_config.yaml` 的 `model.thinking_level` 配置，默认 medium。Web 拾取器只提供 `low` 及以上档位（多数模型不支持关闭思考；`none` 仍是合法的已存值，能正常显示）。对话草稿页在模型选择器旁提供快捷拾取器：选定档位立即写回所选 Agent 的该项配置（切换后的档位即成为该 Agent 的新默认，自下一个 Session 生效）。进行中的会话里，思考等级是**逐轮参数**：输入区拾取器只列出各档位，初始即显示 Agent 配置的档位——用户未手动选择时自动跟随配置下发（请求不携带档位，配置的修改持续生效）；选定某档后即固定为该会话的档位，随之后每次发送携带（仅作用于该会话的后续 Task，不写回 Agent 配置）。见 [配置参考](/configuration)。

## 快速模式

每个模型条目都可以选择进入厂商的快速推理档位（Web 模型弹窗中的「快速模式」开关、`penguin config model add` 的 `--fast-mode` / `--no-fast-mode`，或条目里的 `fast_mode = true`）。默认关闭；既有配置不受影响。

开启后，会话请求携带 AgentHub 的 `fast_mode` 参数：OpenAI 协议 client 发送 `service_tier: "priority"`，Anthropic 协议 client 发送 `speed: "fast"` 并附带 fast-mode beta 请求头。快速档位按厂商的溢价价目计费，而条目记录的按 Token 单价不会随之调整——不上调三档价格的话，快速模式用量的成本统计会偏低。

是否支持取决于模型与厂商，目录中没有能力标志，因此每个模型都提供该开关：

- AgentHub client 没有 fast 档位的模型（Gemini、GLM、Kimi、DeepSeek，以及 Bedrock 上或 Claude 4.6 系列 id 的 Claude）会在**发起网络请求之前**拒绝该参数。该轮会话立即结束，错误信息带上厂商原文与设置入口指引——确定性的拒绝不会重试。
- Anthropic 的 fast mode 是限部分 Opus 模型的 research preview：未获授权的组织在请求时会收到 429 限流错误。
- 部分 OpenAI 兼容服务端会直接忽略该参数，按标准档位处理。

连通性测试会携带弹窗当前的开关状态，因此「测试连通性」能在保存前暴露快速模式被拒的问题。后台请求（会话标题生成、`describe_image` 代读）不携带快速模式——只有会话自身的请求携带。

## 模型与 Agent 解耦

Agent 从不绑定模型：模型在创建 Session 时选定，并在该 Session 内锁定不变；同一个 Agent 可以在不同 Session 用不同模型运行。会话内的 `/model` 命令按 handoff 方式换模型：在同一 Agent 下新建一个使用新模型、沿用当前 Workspace 的会话，首条消息携带 `[model_switch_from]` 源块（源会话 id 与其 Trace 文件路径）——历史不注入新上下文（部分模型回放历史时必须携带 thinking 与 `fidelity`，不能跨模型），模型需要时按路径自行读取；原会话保持不变。`pricing` 三档价格供用量/成本中心按 Token 计费。

凭证处理：

- 内联 `api_key` 存放在权限 0600 的隐藏 Project 配置文件中；
- Web 界面展示时打码；
- 凭证留空时回退到对应 Provider 的环境变量。

## 连通性测试

Web 的模型页为每个模型提供连通性测试(仅 owner 可用)。
