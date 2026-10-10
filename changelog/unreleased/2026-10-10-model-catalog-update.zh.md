# 模型目录更新：Claude 5.5、GPT-6.1 Sol、重读 TokenDance、移除 Gemini 3.7 Flash

- **Date:** 2026-10-10
- **Type:** feature
- **Scope:** `model-catalog`, `core`, `docs`
- **PR:** [#1016](https://github.com/Prism-Shadow/penguin-harness/pull/1016)

[English](2026-10-10-model-catalog-update.md)

内置模型目录于 2026-10-10 更新。MMSP 0.5.2 带来的新 Claude 与 GPT 模型进入 Anthropic、OpenAI 和 OpenRouter 分组；整个 TokenDance 分组按其公开的 portal API 重新读取；OpenRouter 和 SiliconFlow 新增条目；Gemini 3.7 Flash 从所有分组中移除。下文价格均为每百万 Token，顺序为缓存命中 / 输入 / 输出。

## Anthropic 与 OpenAI 分组

- 新增 `claude-fable-5-1`（**Claude Fable 5.1**），USD 0.25 / 10 / 50；`claude-opus-5-5`（**Claude Opus 5.5**），0.20 / 4 / 20；`claude-sonnet-5-5`（**Claude Sonnet 5.5**），0.10 / 2 / 10；以及 `claude-haiku-5-5`（**Claude Haiku 5.5**），0.01 / 0.10 / 0.50。四者上下文窗口均为 1,000,000 Token，支持图像输入，缓存写入一项记录 Anthropic 的 5 分钟写入价（依次为 12.5、5、2.5 和 0.125）。Haiku 5.5 按提示长度计价，提示超过 100,000 Token 时每项费率为 5 倍，条目记录的是基础档。
- 新增 `gpt-6.1-sol`（**GPT-6.1 Sol**），USD 0.10 / 2 / 10，缓存写入一项记录 2.50 的缓存写入价，上下文窗口 1,050,000 Token，支持图像输入。提示超过 272K Token 时价格更高，条目记录的是基础档。
- Haiku 5.5 与 Claude 4.6、Sonnet 5.5、Fable 5.1 一样不提供快速模式开关。MMSP 0.5.2 是 Anthropic 客户端首个认识 `claude-haiku-5-5` 的版本。

## OpenRouter 分组

- 新增上述四个 Claude 模型，即 `anthropic/claude-fable-5.1`、`anthropic/claude-opus-5.5`、`anthropic/claude-sonnet-5.5` 和 `anthropic/claude-haiku-5.5`，以及 `openai/gpt-6.1-sol`，价格均与各自的直连条目相同。
- 新增 `stepfun/step-5-preview`（**Step 5 Preview**），USD 0.05 / 1 / 2.70，上下文窗口 1,000,000 Token；`x-ai/grok-4.7`（**Grok 4.7**），0.50 / 2 / 6，窗口 500,000 Token；`xiaomi/mimo-v2.6-flash`（**MiMo-V2.6-Flash**），0.0028 / 0.14 / 0.28；以及 `xiaomi/mimo-v2.6-pro`（**MiMo-V2.6-Pro**），0.0036 / 0.435 / 0.87，两者窗口均为 1,048,576 Token。四者都支持图像输入。Grok 4.7 在提示超过 200K Token 时费率翻倍，条目记录的是基础档。

## TokenDance 分组

- 本分组按 `tokendance.space/portal/api/models/all` 与 `tokendance.space/gateway/v1/models` 重新读取。
- 新增八个条目：
  - `glm-5.2`（**GLM-5.2**）：CNY 2 / 8 / 28，打 8 折。
  - `glm-5.3-flashx`（**GLM-5.3 FlashX**，支持图像输入）：CNY 0.57 / 2 / 7。
  - `ling-3.0-flash`（**Ling-3.0-flash**）：CNY 0.08 / 0.4 / 1.2，打 3.5 折，上下文窗口 256,000 Token。
  - `ling-3.1-flash`（**Ling-3.1-flash**）：CNY 0.08 / 0.4 / 1.2，按牌价记录。它为期两周的免费体验约于 2026-10-14 结束。
  - `mimo-v2.6-flash`（**MiMo-V2.6-Flash**）：CNY 0.02 / 1 / 2。
  - `mimo-v2.6-pro`（**MiMo-V2.6-Pro**）：CNY 0.025 / 3 / 6。
  - `mimo-v2.6-ultraspeed`（**MiMo-V2.6-Pro-UltraSpeed**）：CNY 0.25 / 30 / 60。
  - `step-5-preview`（**Step 5 Preview**）：CNY 0.35 / 7 / 20。
- MiMo 与 Step 条目支持图像输入。除上文另有说明外，新条目的上下文窗口均为 1,000,000 Token。
- 网关以裸 id `deepseek-v4-flash` 与 `deepseek-v4-pro` 出售的 DeepSeek V4 预览版不作为预置条目；取代它们的 0731 与 0813 带日期条目才是。
- `deepseek-v4-flash-0731` 与 `deepseek-v4-pro-0813` 从固定 9 折改为 DeepSeek 的高峰 / 空闲时段规则。高峰牌价分别为 CNY 0.1 / 3 / 9 与 0.3 / 9 / 27，北京时间工作日 09:00–12:00 和 14:00–18:00 以外的时段减半。
- TokenDance 还在高峰时段对这两条再打 8 折，对 `deepseek-v4.1-flash` 则全天打 8 折。条目无法在时段规则之外再记录促销，所以这些时段按牌价计费。
- `kimi-k3` 的 6 折促销已结束，牌价改为 CNY 2 / 20 / 100。
- 其余条目没有变化：`dots-3-note-preview`、`glm-5.3`、`glm-5.3-flash`、`hy4-preview`、`qwen3.8-flash`、`qwen3.8-max` 和三条 Seed 条目。网关仍在提供它们。

## SiliconFlow 分组

- 新增 `zai-org/GLM-5.3-Flash`（**GLM-5.3 Flash**，支持图像输入），CNY 0.23 / 0.8 / 2.8，上下文窗口 1,048,576 Token。
- `tencent/Hy4-preview` 仍为 CNY 0.3 / 6 / 18，上下文窗口从 1,024,000 改为 SiliconFlow 公布的 1,048,576 Token。

## Gemini 3.7 Flash

- 从 Google 与 Penguin Go 分组移除 `gemini-3.7-flash`，从 OpenRouter 移除 `google/gemini-3.7-flash`。Google 正在停用这个 id，并把对它的请求转给 Gemini 3.8 Flash，而这些分组都已列出 3.8 Flash。

## 文档

- **模型与供应商**页列出新的预置模型与 TokenDance 的新促销，删去 Gemini 3.7 Flash，并把 SiliconFlow 计入 GLM-5.3 Flash 的卖家、把两条 TokenDance DeepSeek 条目计入按时段计价的条目。
- 两份 README 的支持模型表改为 GPT 6.1、Gemini 3.8 Flash 和 Claude 5.5。

## 现有 Project

Project 在创建时获得预置条目，**同步新增模型**只补入缺少的预置条目，不改动已有的任何条目。因此现有 Project 保留已存的条目：

- 被移除的 Gemini 3.7 Flash 条目仍在，保留已存的价格与促销，并且照常可用，因为 Google 会转发这个 id。目录里已没有它的名称，所以除非 Project 自己存了显示名，它会显示模型 id，而不是 **Gemini 3.7 Flash**。
- TokenDance 的 `kimi-k3`、`deepseek-v4-flash-0731` 和 `deepseek-v4-pro-0813` 条目保留原来的价格与促销。

**恢复默认**会把 Project 的内置条目改回上文的价格与促销。Gemini 3.7 Flash 条目已不属于内置条目，所以保持原样。
