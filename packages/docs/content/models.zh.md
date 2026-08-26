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
| `client_type` | 协议提示(`openai-chat` 对应 Chat Completions、`openai-responses` 对应 Responses API、`ant-messages` 对应 Anthropic Messages 等)；缺省由 AgentHub 按 model id 推断。自定义端点使用这三种通用协议客户端之一，Web 对话框可按 base URL 检测其中哪一种。0.4.2 之前的旧写法 `openai` 为已废弃别名，读取配置时归一化为 `openai-chat` |
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
client_type = "openai-chat"
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
| google | `GEMINI_API_KEY` | |
| openai | `OPENAI_API_KEY` | |
| anthropic | `ANTHROPIC_API_KEY` | |
| siliconflow | `OPENAI_API_KEY` | OpenAI 兼容网关，预置 base URL `https://api.siliconflow.cn/v1` |
| tokendance | `OPENAI_API_KEY` | OpenAI 兼容网关，预置 base URL `https://tokendance.space/gateway/v1`；模型 id 为不带厂商前缀的裸 id(如 `glm-5.3`、`kimi-k3`)；价格取该网关自己的 CNY 牌价 |
| zhipu | `ZAI_API_KEY` | |
| moonshot | `MOONSHOT_API_KEY` | |
| minimax | `MINIMAX_API_KEY` | 直连 MiniMax M3 Responses 客户端（`client_type = "minimax-m3"`）：`MiniMax-M3` 支持 1,000,000 Token 上下文和视觉输入；预置 base URL `https://api.minimax.io/v1`；接受 Token Plan Subscription Key 或按量付费 API Key |
| qwen-pay-as-you-go | `OPENAI_API_KEY` | Qwen 按量付费(DashScope OpenAI 兼容端)，预置 base URL `https://dashscope.aliyuncs.com/compatible-mode/v1`；转售第三方模型保留厂商前缀 id(如 `kimi/kimi-k3`) |
| qwen-token-plan | `OPENAI_API_KEY` | Qwen Token Plan 订阅网关，预置 base URL `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`；定价取各模型页官方牌价(预览模型仅配额倍率促销、无牌价) |
| custom | `OPENAI_API_KEY` | 任意 OpenAI 协议端点 |

网关分组(openrouter / fireworks / siliconflow / tokendance / qwen-pay-as-you-go / qwen-token-plan)经 AgentHub 的通用 OpenAI 协议客户端请求，因此凭证留空时读取的是 `OPENAI_API_KEY`，而非网关自己的变量名。多数网关预置固定 Chat Completions 客户端(`client_type = "openai-chat"`)；OpenRouter 的 `openai/*` 预置则固定 Responses 客户端(`client_type = "openai-responses"`)——OpenRouter 在同一 base URL 上提供 Responses API，且这些条目的上游本就是 OpenAI。两种客户端读取相同的 `OPENAI_*` 变量，凭证规则完全一致。直连 MiniMax M3 客户端读取 `MINIMAX_API_KEY`。内置 MiniMax 预设固定使用 `https://api.minimax.io/v1`；仅当模型条目未内联 `base_url` 时才读取 `MINIMAX_BASE_URL`。M3 价格取 MiniMax 按量付费的标准档、输入不超过 512K Token 的牌价；超过 512K 后各档价格翻倍，priority 档另为 1.5 倍，因此长上下文与 priority 用量会被低估——与 OpenAI(>272K)、Gemini 3.1 Pro(>200K)沿用的基准档口径一致。

预置目录还收录了 OpenRouter 的免费档：`:free` 模型变体 `nvidia/nemotron-3-ultra-550b-a55b:free` 与统一路由 `openrouter/free`(Free Models Router)，零成本可用，但受 OpenRouter 免费档速率限制与数据政策约束。

预置目录中的部分模型：deepseek-v4-pro / deepseek-v4-flash / deepseek-v4-flash-vision-exp(DeepSeek 分组中唯一支持图像输入的模型)、MiniMax-M3、gemini-3.7-flash、claude-opus-5 / claude-opus-4-8 / claude-sonnet-5、gpt-5.6 / gpt-5.5、glm-5.3 / glm-5.3-flash、kimi-k3、qwen3.8-max / qwen3.8-flash 等(非完整清单)。OpenAI 全系列都收录了两份——直连(用自己的 OpenAI Key，记牌价)与 OpenRouter 上的 `openai/<id>`(记网关实际计费价，会随其促销浮动)。DeepSeek 直连分组的价格记录官方低谷时段档(高峰时段——北京时间 9:00–12:00、14:00–18:00——按双倍计费)。`glm-5.3-flash` 收录了两份，两条都支持图像输入：AgentHub 的 GLM 客户端只为这一个 GLM id 转发图像部件(其余 GLM id 一律拒绝)，而 OpenRouter 上的 `z-ai/glm-5.3-flash` 走通用 OpenAI 兼容客户端，对任何 id 都能携带图片。两条不一致的是价格——直连条目记 Z.AI 牌价，OpenRouter 条目记网关实际计费的折后价，因此促销期间两者不同。

## 应用归因

部分网关会读取一个请求头，把调用归到发起它的应用名下，用于自己的应用榜单与用量报告。这类请求头由目录按**端点主机名**决定，与条目所在的 Provider 分组无关：一个填在 custom 分组、但 base URL 指向该网关的条目，同样会带上归因头。判断只看条目自己的 `base_url`——从 `OPENAI_BASE_URL` 读到的端点在 AgentHub 内部解析，这一侧看不到，因此不会归因。

| 端点 | 请求头 | 取值 |
| --- | --- | --- |
| `openrouter.ai` | `HTTP-Referer` | `https://penguin.ooo/` |
| `openrouter.ai` | `X-OpenRouter-Title` | `PenguinHarness` |
| `openrouter.ai` | `X-OpenRouter-Categories` | `cli-agent,personal-agent` |
| `tokendance.space` | `X-App-URL` | `https://penguin.ooo/` |

其余端点(所有直连厂商，以及不读归因头的网关)不会收到任何额外请求头。归因头只声明应用身份，不携带用户、Agent 或会话信息。

## 授权新建 API key

若某个供应商公开了授权流程，模型页的该分组头部会多出一个动作：**自动获取密钥**。内置分组中只有 TokenDance 提供。它会在你的账户下**新建**一个 key，而不是读取你已有的 key，并写入该分组下的每一个模型，覆盖这些条目当前的 key。

点击后会在新标签页打开供应商的授权页。在那里完成授权，供应商会把浏览器送回 PenguinHarness，由服务端兑换一次性授权码并保存 key；发起的那个标签页会自行报告结果。上文归因表中的同一个应用 URL 会写到这个 key 上，因此即便换用其他工具，用它发出的调用依然带着归因。

整个兑换过程都在服务端进行：PKCE 的 verifier 在服务端生成、从不进入浏览器，新建出的 key 也直接写入模型表，不经过浏览器。一次授权只能换一个 key，且十分钟后过期。

如果跳转回不来——桌面窗口会把外部链接交给系统浏览器，或者浏览器根本访问不到那个地址的服务——请选择**授权页跳不回来？改为手动填写授权码**。授权页会改为显示一次性授权码，粘贴到对话框即可完成同一套流程。

只有 Project owner 能发起或完成授权。完整的 key 只会出现一次，因此一旦保存失败，需要重新授权，并到供应商控制台删掉那个没用上的 key。

## 本地 / 自建 OpenAI 兼容端点（如 vLLM）

本地推理服务就是一条 `custom` 条目：`client_type = "openai-chat"`、`base_url` 指向服务地址(如 `http://127.0.0.1:8000/v1`)、`model_id` 填服务端的模型名(下文的协议检测对这类服务同样会落到该协议，也可直接用 base URL 输入框右端的后缀菜单手动选它)。两处设置决定运行是否顺畅：

- **服务端要开启工具调用。** vLLM 需以 `--enable-auto-tool-choice` 启动，并按模型选择对应的 `--tool-call-parser`（如 Qwen 用 `hermes`、Llama 3.x 用 `llama3_json`）；不开启时工具调用会以纯文本返回，Agent 循环无法执行任何工具。
- **条目的 `context_window` 填服务端的真实窗口**——vLLM 即 `--max-model-len` 的值（如 `32768`）。每次请求的输出上限与压缩阈值都会由该窗口自动推导：请求把 `max_tokens` 收敛到窗口剩余空间以内，压缩也会在撞上窗口硬限制之前触发，无需手工调低 `max_tokens`。不填时不做逐请求输出收敛、压缩按 128000 假定，真实窗口更小会导致请求被拒。

## 自定义模型的协议检测

Custom 与自建分组走 AgentHub 的通用协议客户端，Web 对话框会检测 base URL 实际提供的是哪一种。新建自定义模型时**默认不选择任何协议**：base URL 输入框右端的后缀显示「选择协议」而不是某条路径，其菜单中也没有任何一项被勾选。「检测协议」按钮位于该输入框右上角、与标签同一行，始终可点击——不需要先填 API Key。点击它，服务端按固定顺序向该 URL 发三个轻量探测请求——先 `openai-responses`（`POST {base}/responses`，OpenAI Responses API），再 `ant-messages`（`POST {base}/v1/messages`，Anthropic Messages API），最后 `openai-chat`（`POST {base}/chat/completions`）——第一个真正被端点提供的协议写入条目的 `client_type`，并以 toast 提示检测到的是哪一种。表单里不会留下任何结果文字——协议最终落在哪，看后缀即可，那才是真正承载它的地方。

保存是兜底环节：若确认对话框时协议仍为空，会先自动检测，再带着检测结果继续保存（这段往返期间按钮显示「检测中…」）。此处检测成功不额外提示——你要的保存直接继续。若这次探测什么都没找到，模型**不会**被保存：toast 说明原因，对话框保持打开，你可以手动选协议或修正 URL。这一步是必要的：AgentHub 遇到无法匹配的 client type 会直接抛错而不是回退默认值，协议为空的条目就是一个根本起不来的模型。

探测请求是刻意构造的最小非法请求（`{}` 请求体）：不消耗 Token、不需要有效的模型 id——按协议自身形态返回的错误即证明路由存在；`404`/`405` 则说明该路径未提供，HTML 或网关杂讯一概不算数。探测的 URL 与鉴权头和保存后 AgentHub 客户端实际使用的完全一致（OpenAI 系协议用 `Authorization: Bearer`；`ant-messages` 同时带 `x-api-key`、`Authorization: Bearer` 与 `anthropic-version`），因此检测出的协议就是真正能跑通的协议。

探测所用凭据在服务端按三层依次解析：对话框里填的 API Key，其次该条目已保存的密钥，最后是**当前这个探测**所用协议对应的环境变量——`ant-messages` 读 `ANTHROPIC_API_KEY`，两个 OpenAI 协议读 `OPENAI_API_KEY`，与保存后模型实际读取的是同一批变量。之所以逐个探测分别解析，正是因为协议本身还没确定。这些值都不会回传浏览器，也不会出现在响应里。完全没有凭据时检测同样可用——协议形态的 `401` 足以认出路由——但带上鉴权的探测，远比匿名请求更容易拿到那种协议形态的应答，而不是笼统的 `401` 或网关 HTML。

手动覆盖入口是 base URL 输入框右端内嵌的那段协议路径（`/responses`、`/v1/messages`、`/chat/completions`）——客户端会追加到你填的 URL 之后，与协议一一对应。点开它即列出三种协议及各自追加的路径，手动选择优先于检测结果——已经知道协议的端点根本不必探测。只要检测失败——连不上、超时、返回的不是 API 响应、三条路径都没提供——该后缀就转为琥珀色，并统一以 toast 提示同一句话：无法检测接口协议，请检查 API Key 与 base URL。逐个协议的探测结果仍由该接口返回，便于排查。此前创建的条目保留 `client_type = "openai"`（仍是 `openai-chat` 的别名），只有手动选择或检测生效时才会改写。检测能力以 `POST /api/projects/:id/models/detect` 暴露（仅 owner，见 [Server API](/server-api)）。

这些分组不会从 model id 推断任何东西。在自定义分组里填 `claude-sonnet-5` 不代表就走 Anthropic 客户端、读 `ANTHROPIC_*`——Custom 与自建分组一律回退到兼容客户端(`openai-chat`)，API Key 提示也据此显示。检测只是锦上添花，不是关卡：若检测无结果，模型仍会按 `openai-chat` 保存，并以 toast 说明。厂商与网关分组不受影响——它们的 id 在内置目录里，仍按 id 路由或沿用预设。

「新增分组」对话框在分组名下方提供两种模式。**仅新增分组**是轻量路径：名称合法即进入该分组的新增模型对话框。**导入模型**按端点填满全新分组，沿用新增模型对话框的字段节奏——先填 API key，再填 base URL，其右上方是「检测协议」，输入框内嵌的协议菜单可手动改选。协议确定后（检测命中或手动选定）出现**「批量导入模型」**：向端点询问它服务的全部模型 id（`POST /api/projects/:id/models/list`，仅 owner——在该协议客户端上调用 AgentHub 的 `listModels()`，限时 20s），并在一次整表写入中把它们全部存为新分组的条目——base URL、协议与所填 key 内联在每条上——顺序保持端点返回的顺序。配置无法承载的 id（为空、超过 200 字符、含控制字符）以及已被占用的 id 会被跳过并计入 toast，因此单个坏条目不会让整次导入失败。端点那边只取 id：价格、上下文窗口与显示名一律留空；导入的模型在你探测或手动打开之前不声明视觉能力——与手动往该分组添加模型的起点完全一致。key 留空时沿用各处一致的按协议环境变量回退。检测失败只把后缀转为琥珀色、不阻塞任何操作——可手动选协议继续，或切回仅新增分组；列表失败（协议不支持列出模型、列表为空）只在对话框内呈现且不落盘。

### 视觉能力检测

「支持视觉」可以先不开，交给模型自己回答：开关旁边的「检测」会发送一张 1x1 的 PNG 和一句一个词的提示，模型能正常作答就把开关打开。若模型明确回答不接受图片，则关闭开关——这是一个真实答案，不是错误；而因鉴权或网络失败的探测则什么都不改动，只显示那句「请检查 API Key 与 base URL」。

与协议检测不同，**这次探测是一次真实计费的补全**：图片请求无法像协议探测那样构造成零成本。因此它只在你主动点击时运行，不会自行触发，保存时也不会。凭据链与连通性测试一致——对话框里填的 Key，其次已保存的 Key，最后是该协议的环境变量，全部在服务端解析。新建的自定义模型默认关闭视觉；从厂商或网关分组添加的模型沿用内置目录已知的能力。


## 思考等级

对于 MiniMax M3，`none` 会直接映射为 `reasoning.effort = "none"`。

DeepSeek V4 只接受 `low`/`high`/`max`，服务端会把 `medium` 与 `xhigh` 都折算成 `high`。AgentHub 0.4.4 让 client 与这套取值对齐，因此在 DeepSeek 模型上，`low` 现在发送 `low`（此前发送 `high`），`xhigh` 现在发送 `high`（此前发送 `max`）：停在 `low` 的会话思考更浅、花费也更少，停在 `xhigh` 的会话思考深度有所下降。想要 DeepSeek 最深的思考档位，请选 `max`。

思考等级共六档：`none | low | medium | high | xhigh | max`，按 Agent 在 `system_config.yaml` 的 `model.thinking_level` 配置，默认 medium。Web 拾取器只提供 `low` 及以上档位（多数模型不支持关闭思考；`none` 仍是合法的已存值，能正常显示）。每个档位都以实际发送的取值标注，标签即请求上真正带的值。`max` 是最深的一档：各 client 会把它映射到对应厂商能接受的最深档位，厂商没有这一档时静默降级，因此选它不会失败——在 Gemini 与 MiniMax M3 上它与 `xhigh` 落到同一档。对话草稿页在模型选择器旁提供快捷拾取器：选定档位立即写回所选 Agent 的该项配置（切换后的档位即成为该 Agent 的新默认，自下一个 Session 生效）。进行中的会话里，思考等级是**逐轮参数**：输入区拾取器只列出各档位，初始即显示 Agent 配置的档位——用户未手动选择时自动跟随配置下发（请求不携带档位，配置的修改持续生效）；选定某档后即固定为该会话的档位，随之后每次发送携带（仅作用于该会话的后续 Task，不写回 Agent 配置）。见 [配置参考](/configuration)。

## 快速模式

每个模型条目都可以选择进入厂商的快速推理档位（Web 模型弹窗中的「快速模式」开关、`penguin config model add` 的 `--fast-mode` / `--no-fast-mode`，或条目里的 `fast_mode = true`）。默认关闭；既有配置不受影响。打开开关会先弹出确认提示，因为它会改变该模型的计费。

开启后，会话请求携带 AgentHub 的 `fast_mode` 参数：OpenAI 协议 client 发送 `service_tier: "priority"`，Anthropic 协议 client 发送 `speed: "fast"` 并附带 fast-mode beta 请求头。快速档位按厂商的溢价价目计费（MiniMax 为标准价的 1.5 倍，OpenAI 与 Anthropic 另有溢价价目表），而条目记录的按 Token 单价不会随之调整——不上调三档价格的话，快速模式用量的成本统计会偏低。

### 哪些模型会出现该开关

是否存在快速档位，由该模型路由到的 AgentHub client 决定，而不是由模型条目决定，因此开关只在该 client 确实会发送这个参数时才出现：

| 路由到的 client | 快速模式 |
| --- | --- |
| OpenAI 协议（`openai_chat`、`openai_responses`、`gpt5_6`、`minimax_m3`） | 发送 `service_tier: "priority"` |
| Anthropic 协议（`ant_messages`、`claude5`） | 发送 `speed: "fast"` 并附带 beta 请求头 |
| Gemini、GLM、Kimi、DeepSeek、OpenAI embedding | 拒绝——不提供开关 |
| Bedrock 上的 Claude，或 Claude 4.6 系列 id | 拒绝——不提供开关 |

路由按条目的 `client_type` 判定，未设置时按 `model_id` 判定，所以同一个上游 id 可能落到不同 client：在网关分组下添加的 Kimi 模型（`client_type = "openai"`）可以使用快速模式，同一个 id 路由到 Kimi 自己的 client 时则不行。自建 base URL 的自定义模型仍然保留开关——它走 OpenAI 协议，背后也可能就是 OpenAI——但第三方服务端完全可能接受该参数却仍按标准档位处理。

有两件事开关无法替你检查：

- Anthropic 的快速模式是限量的 research preview：在你的组织获得授权之前，请求会返回 429 限流错误。Anthropic 协议的模型在确认弹窗里会给出这条提示。
- 服务端环境变量 `CLIENT_TYPE` 与 `ANTHROPIC_BASE_URL` 会覆盖条目的配置，可能把模型路由到开关未曾预期的地方。

如果请求最终仍到达了拒绝 `fast_mode` 的 client，AgentHub 会在**发起网络请求之前**拒绝：该轮会话立即结束，错误信息带上厂商原文与设置入口指引，确定性的拒绝不会重试。若某个条目在不支持的模型上存有 `fast_mode = true`，弹窗仍会显示该开关并标注不支持，以便随时关闭。

连通性测试会携带弹窗当前的开关状态，因此「测试连通性」能在保存前暴露快速模式被拒的问题。后台请求（会话标题生成、`describe_image` 代读）不携带快速模式——只有会话自身的请求携带。

## 模型与 Agent 解耦

Agent 从不绑定模型：模型在创建 Session 时选定，并在该 Session 内锁定不变；同一个 Agent 可以在不同 Session 用不同模型运行。会话内的 `/model` 命令按 handoff 方式换模型：在同一 Agent 下新建一个使用新模型、沿用当前 Workspace 的会话，首条消息携带 `[model_switch_from]` 源块（源会话 id 与其 Trace 文件路径）——历史不注入新上下文（部分模型回放历史时必须携带 thinking 与 `fidelity`，不能跨模型），模型需要时按路径自行读取；原会话保持不变。`pricing` 三档价格供用量/成本中心按 Token 计费。

凭证处理：

- 内联 `api_key` 存放在权限 0600 的隐藏 Project 配置文件中；
- Web 界面展示时打码；
- 凭证留空时回退到对应 Provider 的环境变量。

## 连通性测试

Web 的模型页为每个模型提供连通性测试(仅 owner 可用)。
