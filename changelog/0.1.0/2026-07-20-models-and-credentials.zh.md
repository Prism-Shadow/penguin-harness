# 模型目录、模型页与凭证处理

- **Date:** 2026-07-20
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `cli`, `model-catalog`
- **PR:** [#7](https://github.com/Prism-Shadow/penguin-harness/pull/7)

[English](2026-07-20-models-and-credentials.md)

预置 Provider 分组、目录条目与排序，以及围绕它们构建的模型页功能。

## 模型目录新增 Qwen Token Plan 分组

内置目录新增 Qwen Token Plan 订阅网关分组（OpenAI 兼容，预置 base URL），含五个模型——qwen3.8-max-preview、qwen3.7-max、qwen3.7-plus、glm-5.2 与 deepseek-v4-pro——并配一枚自定义 Provider 图标。

## 细节

- 新增 Provider `qwen-token-plan`（"Qwen Token Plan"），置于 SiliconFlow 之后的网关簇中：OpenAI 兼容端点预置为 `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`，取 key 页面为 `https://platform.qianwenai.com/pricing/token-plan`，模型 id 文档页为 `https://platform.qianwenai.com/docs/token-plan/personal/token-plan-personal-overview`；环境变量回退与其他网关一样是 `OPENAI_API_KEY`/`OPENAI_BASE_URL`。
- 五个目录条目，均为 `client_type: openai` 并内联 base URL。视觉能力标记依该计划的支持模型表（qwen3.8-max-preview 与 qwen3.7-plus 可读图，其余不可）。定价与上下文窗口取自各模型在 `www.qianwenai.com/models/<id>` 的页面（官方人民币牌价；限时促销不予记录）：qwen3.7-max ¥2.4/¥12/¥36，qwen3.7-plus ¥0.4/¥2/¥8，glm-5.2 ¥2/¥8/¥28，deepseek-v4-pro ¥1/¥12/¥24（每百万 Token 的缓存命中/输入/输出），窗口均为 1M（glm-5.2 为 1.04M）。qwen3.8-max-preview 仅为预览版，只有配额倍率促销、没有按 Token 的牌价，因此只有它不带定价（成本读作 0，与未定价的用户模型一致）；目录测试中的定价不变式针对这一个条目做了豁免。
- 目录不变式更新：裸模型 id 现在允许在不同 Provider 之间重复（网关会以上游 id 转售厂商模型，例如 `glm-5.2` / `deepseek-v4-pro`）；唯一性由 `(provider, model_id)` 二元组保证，与目录唯一的查找键一致。
- 新增 Provider 图标：取自品牌 SVG 的官方 Qwen 字标（图形 + 文字），渐变填充扁平化为 currentColor 单色，坐标保留两位小数。
- 文档（models.en/zh）的 Provider 表与网关说明同步更新。

## 新增 Qwen Pay-As-You-Go 分组

在 Qwen Token Plan 之下新增一个按 Token 计费的网关分组（DashScope 的 OpenAI 兼容端点），含四个预置模型——qwen3.7-max、qwen3.7-plus，以及转售的带厂商前缀的 kimi/kimi-k3 与 ZHIPU/GLM-5.2——定价取自各模型的官方页面。

## 细节

- 新增 Provider `qwen-pay-as-you-go`（"Qwen Pay-As-You-Go"），在网关簇中紧随 Qwen Token Plan：预置 base URL `https://dashscope.aliyuncs.com/compatible-mode/v1`，取 key 链接 `https://platform.qianwenai.com/docs/api-reference/preparation/api-key`，模型页 `https://www.qianwenai.com/models`；与其他网关一样使用 `OPENAI_*` 环境变量回退。
- 四个条目（`client_type: openai` + 内联端点），官方人民币牌价与规格取自各模型页面：kimi/kimi-k3 ¥2/¥20/¥100（1.04M，支持视觉），qwen3.7-max ¥2.4/¥12/¥36（1M），ZHIPU/GLM-5.2 ¥2/¥8/¥28（1.04M），qwen3.7-plus ¥0.4/¥2/¥8（1M，支持视觉）。转售的第三方模型保留其带厂商前缀的上游 id。
- 该分组共用 Qwen 徽标（图形已抽取为共享常量），`modelHomepageUrl` 会对带斜杠前缀的 id 做 URL 编码（`.../models/ZHIPU%2FGLM-5.2`）。文档（models.en/zh）的 Provider 表与网关说明同步更新。

## 新增 Fireworks AI 分组

在 OpenRouter 之下新增一个 OpenAI 协议网关分组，含五个预置模型（GLM-5.2、Kimi K2.7 Code、DeepSeek V4 Pro、MiniMax M3、DeepSeek V4 Flash），定价取自各模型的 Fireworks 页面。

## 细节

- 新增 Provider `fireworks`（"Fireworks AI"），在网关簇中紧随 OpenRouter：预置 base URL `https://api.fireworks.ai/inference/v1`，取 key 页面 `https://app.fireworks.ai/settings/users/api-keys`，模型页 `https://app.fireworks.ai/models`；与其他网关一样使用 `OPENAI_*` 环境变量回退。
- 五个条目（`client_type: openai` + 内联端点），采用标准 serverless 的美元定价（每百万 Token 的缓存输入 / 非缓存输入 / 输出）与各页面的规格：glm-5p2 $0.14/$1.40/$4.40（1M），kimi-k2p7-code $0.19/$0.95/$4.00（262K，支持视觉），deepseek-v4-pro $0.15/$1.74/$3.48（1M），minimax-m3 $0.06/$0.30/$1.20（512K，支持视觉），deepseek-v4-flash $0.03/$0.14/$0.28（1M）。API 模型 id 使用 Fireworks 完整的 `accounts/fireworks/models/<slug>` 形式（原样发送）。
- `modelHomepageUrl` 把 `accounts/<owner>/models/<slug>` 形式的 id 映射到模型页面（`app.fireworks.ai/models/<owner>/<slug>`），对不符合该形式的用户自建 id 则回退到模型列表页。品牌标识先以一个简化的星芒图形近似（与 Z.AI 的做法相同）。文档（models.en/zh）的 Provider 表与网关说明同步更新。

## OpenRouter 目录扩充十二个模型

OpenRouter 网关分组从 4 个条目扩充到 16 个，新增当前的旗舰档与免费档，定价、上下文窗口与视觉能力标记均取自各模型的 OpenRouter 页面。

## 细节

- 新增（按输出价格排序）：anthropic/claude-fable-5（$10/$50）、openai/gpt-5.6-sol（$5/$30）、openai/gpt-5.5（$5/$30）、anthropic/claude-opus-4.8（$5/$25）、anthropic/claude-opus-4.7（$5/$25）、moonshotai/kimi-k3（$3/$15）、openai/gpt-5.6-terra（$2.50/$15）、anthropic/claude-sonnet-5（$2/$10）、z-ai/glm-5.2（$0.93/$3）、deepseek/deepseek-v4-pro（$0.435/$0.87）、deepseek/deepseek-v4-flash（$0.09/$0.18），以及 nvidia/nemotron-3-ultra-550b-a55b:free（每百万 Token 的输入/输出；上下文均为 1M）。
- 视觉能力依各页面：Claude 系列、GPT-5.5 与 Kimi K3 接受图像输入，其余不接受。
- 这些页面均未列出缓存价格，因此 cache_read 采用标准输入价（不打折）。`:free` 档存储的是真实的 $0 价格——而非「未知」——因此成本能正确算作 0；目录的定价不变式为免费档新增了一个分支。

## OpenRouter 目录新增 Grok 4.5

`x-ai/grok-4.5` 加入 OpenRouter 分组：每百万 Token 输入 $2 / 输出 $6（未列出缓存价格，因此 cache_read 采用输入价），500K 上下文，支持视觉——插入在其字典序位置上。

## OpenRouter 目录新增 Gemini 3.5 Flash

`google/gemini-3.5-flash` 加入 OpenRouter 分组：每百万 Token 输入 $1.50 / 输出 $9（未列出缓存价格，因此 cache_read 采用输入价），1M 上下文，支持视觉——置于其字典序位置；README 模型表中 Gemini 那一行现在也列出 OpenRouter。

## 目录模型按字典序排列，同系列新版本在前

在每个 Provider 分组内部，目录条目现在按模型 id 的字典序排列，但同一系列的较新版本排在前面（gpt-5.6-* 先于 gpt-5.5，claude-opus-4.8 先于 4.7，glm-5.2 先于 glm-5）——顺序在目录字面量中手工预先算好，运行时任何地方都不做排序。

## 细节

- MODEL_CATALOG 的每个 Provider 小节都做了手工重排：跨系列与档位按字典序（不区分大小写）；在一个版本系列内部，最新版本的区块领先，同一版本内的各档位保持字母序。小节注释与精确顺序的测试断言同步更新。
- 这个顺序会流向所有保留分组内顺序的地方：新 Project 的预置配置、模型页卡片，以及聊天模型下拉框（orderModelsLikeLibrary）。已有 Project 配置保留其已存顺序——预设同步的合并刻意保留本地位置。

## 目录数据：官方 Fireworks 图标、两个 SiliconFlow 模型、逐模型的厂商页面

Fireworks 分组换上官方的爆发标识，SiliconFlow 新增 moonshotai/Kimi-K2.7-Code 与 deepseek-ai/DeepSeek-V4-Flash，Z.AI / Moonshot 的模型则链接到各自的逐模型文档页。

## 细节

- Fireworks 图标：官方的三笔爆发标识（viewBox 0 0 638 315，currentColor）取代此前过渡性的星芒近似图形。
- SiliconFlow 条目（官方人民币定价，按字典序位置）：deepseek-ai/DeepSeek-V4-Flash ¥0.02/¥1/¥2（1M），moonshotai/Kimi-K2.7-Code ¥1.3/¥6.5/¥27（262K，支持视觉）。
- modelHomepageUrl：zhipu → `docs.z.ai/guides/llm/<model_id>`；moonshot → `platform.kimi.com/docs/pricing/chat-k<去掉点的版本号>`（kimi-k2.6 → chat-k26），不符合该形式的 id 回退到该分组的模型页。

## 模型页新增预设同步按钮

模型页搜索框旁新增一个仅所有者可见的小按钮，用于把内置目录合并进 Project 的模型表：本地缺失的目录条目会被新增，两边都有的条目会被重置为目录中的字段，本地自行添加的模型与 API key 不受影响。

## 细节

- 并集语义（`catalog-sync.ts`，纯函数且有单元测试）：以 `(provider, model_id)` 二元组为键。仅目录中存在的条目被追加（网关 base URL 预置）；两边都存在的条目采用目录的上下文窗口、定价（包括当目录不带定价时予以移除，例如那个未定价的预览模型）、协议、base URL 与视觉标记——只要两边有差异就以目录为准；仅本地存在的模型（包括用户自定义分组）原样保留在原位。
- 凭证在结构上不受影响：被合并的行不提交 `apiKey`（PUT 的整表替换在该字段缺失时保留已存 key），已有行保持其凭证状态；而预置模型上被用户覆盖的 base URL 会被重置为目录中的值（API key 是唯一的例外）。
- 通过 toast 反馈：「已同步预设：新增 N 个，更新 M 个」，或在没有差异时不发 PUT 直接提示「已是最新」。相应字符串已加入两种语言。
- Qwen Token Plan 的 Provider 图标精简为仅保留官方徽标（去掉字标文字），置于方形 viewBox 中。

## 模型测试不再因「只有思考」的响应而失败

测试一个重推理的模型（例如 qwen3.8-max-preview）会失败并报 "OpenaiClient returned no content other than thinking (finish_reason=\"length\")"：连通性探测那点极小的输出上限被思考内容全部烧光了。现在探测把「流式输出以纯思考结束」也视为可达——端点、凭证与模型 id 都已被证明可用。

## 细节

- 该探测刻意只发一次 "ping"，设 `maxTokens: 16` 并关闭思考（成本按设计只有个位数 Token）。位于 OpenAI 兼容端点之后的推理模型可能忽略被关闭的思考等级，在没有文本的情况下触及 `finish_reason=length`，于是 AgentHub 0.4 抛出 `EmptyResponseError`——它被归结为 `malformed` 结果，而探测此前会把它报告为测试失败。
- `testModel` 现在会跟踪是否有真正的模型内容（思考或文本，无论部分还是完整）被流式输出过；在已有内容流出之后出现的 `malformed` 结束视为测试通过；超时、认证/参数失败，以及什么都没收到的 `malformed` 结束仍然判为失败。该逻辑落在两个纯函数（`isProbeContent` / `probeVerdict`）中并有单元测试覆盖，其中包含 qwen3.8-max-preview 这个确切场景。

## 模型页的分组测速

每个模型分组的头部新增一个仅所有者可见的测速操作：在配额警告之后，它逐个探测该分组的模型，测量首 Token 时延与输出速率，并把带色调的徽章（绿 / 黄 / 红）写到每张卡片上；模型主页链接则从卡片角落移入配置对话框。

## 细节

- Server：模型测试端点新增 `speed` 标志——探测的输出上限从 16 提高到 64 个 Token，以便存在一个真实的流式窗口；响应现在携带 `ttftMs`（请求开始 → 首个流式内容）与 `tps`（流式窗口内的输出 Token 数，取自完成流的 usage 报告；纯思考结束的情况带 TTFT 但没有速率）。普通连通性测试未变。
- Web：每个分组头部有一个仪表图标按钮（仅所有者可见），点击后弹出确认对话框，警告每个模型会发出一次真实请求并消耗 API 配额；确认后该分组会被**严格串行**地测试（并发探测会触发 Provider 的限流），每个结果在完成时即落到对应卡片上。徽章：时钟图标 + 毫秒表示 TTFT（< 1s 绿、≤ 3s 黄、更高为红），闪电图标 + tok/s 表示 TPS（≥ 40 绿、≥ 15 黄、更低为红）；失败显示红色的「测试失败」，原因在悬停时给出。阈值放在一个纯函数助手中并有单元测试；结果的作用域限于当前会话。
- 模型主页链接从卡片角落移入配置对话框，紧邻「获取模型 id」链接（卡片保持为单一可点击面；空出的角落用于放测速徽章）。
- 细节改进：分组头部的操作（添加模型 / 统一填 key / 测速）统一为图标 + 文字按钮；测速徽章位于卡片元信息行上一个不收缩的独立槽位中（数字永远不会挤压或折行标题）；探测提示词会抑制推理，并以一个空的 `<think></think>` 块结尾，使推理模型跳过思考阶段，而不是把探测预算烧在上面。

## 模型页细节改进：草稿跟随新默认值、下拉框排序、GPT 视觉、主页链接

四项改进：修改 Project 默认模型后，已保存草稿的模型选择会重置为跟随新的默认值；聊天模型下拉框的顺序与模型库页一致；所有 GPT 模型都标记为支持视觉；模型卡片链接到各模型主页。

## 细节

- 草稿跟随默认值：在模型页保存默认模型的修改时，当前用户在该 Project 下已保存的草稿会丢弃其 `modelRef`——于是草稿聊天会实时解析（新的）默认值，而不是永远钉在旧模型上。
- 下拉框顺序：新增的 `orderModelsLikeLibrary` 助手（有单元测试）把库的分组结构展平——内置 Provider 分组按 MODEL_PROVIDERS 的顺序、用户自定义分组随后、custom 置于最后，分组内顺序保留——聊天模型下拉框现在使用它。
- GPT 视觉：`openai/gpt-5.6-sol` 与 `openai/gpt-5.6-terra` 改为支持视觉——GPT 系列一律是多模态的（OpenAI 的产品线策略），即便网关页面漏写了该模态。
- 主页链接：新增 `modelHomepageUrl` 助手（有单元测试）——OpenRouter 与 Qwen Token Plan 有稳定的逐模型 URL 规律（对这些分组中用户自建的 id 同样有效；没有独立页面的 Token Plan 预览模型回退到计划总览页），原厂直连的 Provider 链接到其模型文档页，custom 与用户自定义分组则没有链接。模型卡片以角落的外链图标呈现该链接（作为可点击卡片的兄弟节点，因为交互元素不得嵌套）。

## penguin-sdk 与 agenthub-models 让模型 key 留在项目本地

两个 Skill 现在都明确写出模型 API key 应该放在哪里：放在工作目录下的项目里，绝不放进用户的全局 `~/.penguin`。

- penguin-sdk（v6）与 agenthub-models（v3）指示用 penguin CLI 把 key 配置到 CWD 之下应用自己的数据根目录中（`penguin config model add --root <data_dir> …`），或者依赖 vault 注入的环境变量；读取、复制或回退到存放在全局 `~/.penguin` 目录中的模型 key 被明令禁止——那份配置属于运行 Penguin 的人，而不属于正在构建的这个应用。
- 无 key 时的路径与此前一致：停下来，请用户通过卡片上的齿轮图标打开 Agent 设置并更新 key vault。

## Vault 的修改在下一个 Task 生效；全局 key 不算可用

保存 vault 现在会让该 Agent 缓存的 Session 运行时失效，使下一个 Task 以新值运行；同时 AI 应用类 Skill 不再把全局 `~/.penguin` 中的 key 算作可用。

- Server：`PUT /agents/:agentId/vault` 会在会话管理器中递增该 Agent 的配置代次；所有在此次更新之前构建的运行时，会在其下一次空闲访问时被丢弃并经加载器重新恢复（恢复过程会重新读取 `agent_state/.vault.toml`；历史通过 Trace 得以保留）。已在执行中的 Task 保持它启动时的取值，并在结束后的首次访问时重建。单元测试与集成测试覆盖了空闲/繁忙两种条目以及 HTTP 接线；配置文档（中英）与 Web 端 Vault 标签页的提示记录了新语义。
- penguin-sdk（v9）与 agenthub-models（v6）：只有两个来源算作可用凭证——vault 注入的环境变量，或配置在应用自己数据根目录中的 key（`penguin config model list --root <data_dir>`）。全局 `~/.penguin` 中的 key（也就是不带 `--root` 直接执行 `penguin config model list` 所读到的内容——CLI 默认指向全局根目录）以及任何其他 `.penguin` 目录中的 key 一律不算，且绝不可使用或复制；当没有任何算数的 key 可用时，立即停止并请用户去配置一个，而不是继续构建或重试。
