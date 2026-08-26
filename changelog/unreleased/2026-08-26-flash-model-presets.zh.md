# 三个 Flash 预设：GLM-5.3 Flash（直连 + OpenRouter）与 Qwen 3.8 Flash

- **Date:** 2026-08-26
- **Type:** feature
- **Scope:** `model-catalog`, `core`, `docs`, `skills`
- **PR:** [#469](https://github.com/Prism-Shadow/penguin-harness/pull/469)

[English](2026-08-26-flash-model-presets.md)

内置模型目录新增三条低价条目：直连 Z.AI (GLM) 分组的 `glm-5.3-flash`、它在 OpenRouter 上的网关条目 `z-ai/glm-5.3-flash`，以及 Qwen 按量付费分组的 `qwen3.8-flash`。三者都是百万级 Token 上下文，价格比各自的非 Flash 同系列条目低约一个数量级。

## 细节

- **`glm-5.3-flash`（provider `zhipu`）**——展示名 GLM-5.3 Flash，1,000,000 Token 上下文，每百万 Token $0.03 / $0.15 / $0.50（缓存读取 / 缓存写入 / 输出），于 2026-08-26 从 https://docs.z.ai/guides/overview/pricing 与 https://docs.z.ai/guides/vlm/glm-5.3-flash 读取。直连厂商条目记录厂商牌价，因此该行存的是牌价，并在注释中点明那场把三档价格各打对折、持续到 2026-09-09 24:00（UTC+8）的 50% 促销。与其余直连 Z.AI 预设一样，它既不固定 `client_type` 也不固定 `base_url`：AgentHub 依据 `glm-5` 子串把该 id 路由到统一 GLM 客户端，凭证留空时回退到 `ZAI_API_KEY` / `ZAI_BASE_URL`。
- **直连条目标记为 `vision = false`**，尽管该模型原生支持多模态。AgentHub 的 GLM 客户端会以 `"GLM-5 does not support image inputs."` 直接拒绝图像输入——正是这同一处限制让 `glm-5v-turbo` 整条被排除在目录之外。目录注释写明了翻转该标记的条件：core 所固定的版本范围内出现一个 `glm5_3` 客户端会转发 `image_url` 部件的 `@prismshadow/agenthub` 版本。
- **`z-ai/glm-5.3-flash`（provider `openrouter`）**——1,048,576 Token 上下文，`vision = true`，固定 `client_type = "openai-chat"` 与预置的 OpenRouter base URL，与同组的 `z-ai/glm-5.3` 一致。它正处在一场持续到 2026-09-09 16:00 UTC 的 ZAI 五折促销中；网关条目记录网关实际计费的价格，因此该行存 $0.015 / $0.075 / $0.25，并在注释中点明促销结束后应恢复的 $0.03 / $0.15 / $0.50。于是同一个模型在两条路径上得到不同的结论——直连为 text-only，经 OpenRouter 的通用 OpenAI 兼容客户端则可接收图片——促销期间价格也不同。
- **`qwen3.8-flash`（provider `qwen-pay-as-you-go`）**——展示名 Qwen 3.8 Flash，1,000,000 Token 输入窗口（输出上限 131K），`vision = true`，固定 `client_type = "openai-chat"` 与预置的 DashScope base URL。官方 CNY 牌价于 2026-08-26 从 https://www.qianwenai.com/models/qwen3.8-flash 读取：每百万 Token 输入 CNY 1 / 缓存命中 CNY 0.1 / 输出 CNY 3，按目录 7:1 的展示口径换算后存储。
- 每条都放在目录排序规则要求的位置——分组内按 model id 字典序排列、同一系列的新版本在前——因此 `glm-5.3-flash` 紧随 `glm-5.3`、`z-ai/glm-5.3-flash` 紧随 `z-ai/glm-5.3`、`qwen3.8-flash` 位于 `qwen3.8-max` 之前。测试固定了这三处位置，以及每条的价格、上下文窗口、视觉标记与协议固定值，并固定了 `glm-5.3-flash` 仍解析到 `ZAI_*` 变量对。

## 文档与 Skill

- 中英文 `models` 页在预置目录的示例清单中列出这三个 id，并记下 `glm-5.3-flash` 为何被收录两份、视觉标记不同，以及促销期间价格为何不同。
- `agenthub-models` skill（v16）的模型 id 表收入这三个 id——`glm-5.3-flash` 与 `z-ai/glm-5.3-flash` 并入 GLM 5.3 行，`qwen3.8-flash` 新起一行 Qwen 3.8 Flash——并补了一条说明：直连 GLM id 实际上只能用于纯文本，因为 GLM 客户端拒绝图像输入；同时在其余 Qwen 网关旁点出 DashScope 的端点。

## 兼容性

既有 Project 不会自动获得这些预设：预设是在 Project 创建时复制进 `.project_config.toml` 的，此后没有任何机制会改写它们。对已经存在的 Project，请在模型页面使用**同步预设**把这些条目引入——它只会追加 Project 缺少的目录条目、并更新已有条目中由目录所有的字段，不删除任何内容，也不会改动已存的默认模型与任何凭证。
