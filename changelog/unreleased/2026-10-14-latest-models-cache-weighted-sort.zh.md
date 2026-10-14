# GPT-6 Luna、OpenCode Go 新预设与缓存加权价格排序

- **Date:** 2026-10-14
- **Type:** feature
- **Scope:** `model-catalog`, `web`, `docs`
- **PR:** [#1137](https://github.com/Prism-Shadow/penguin-harness/pull/1137)

[English](2026-10-14-latest-models-cache-weighted-sort.md)

在 OpenAI、OpenRouter 和 OpenCode Go 中新增 GPT-6 Luna，MMSP 依赖版本保持不变。

## 模型与文档

- Go 新增 Claude Haiku 5.5、Gemini 4 Argon Contributor、Grok 4.7、MiMo-V2.6 Flash/Pro、LongCat 2.5 Preview Free、Step 5 Preview Free、Cat Jam Free 和 Space Bunny 预设。各型号分别保留最新一代，包括 DeepSeek V4 Pro 与 V4.1 Flash，以及 Qwen 的 Max、Flash、Plus。
- Go 的**获取 API Key**链接改为 [OpenCode 认证说明](https://opencode.ai/v2/docs/console/api/inference/#authentication)。Gemini 通过 Go 的 generateContent 端点调用，沿用现有 MMSP 依赖。
- 中英文 README 将重点支持的模型系列分为闭源、开源两组。Fable 5.1、Opus 5.5 和 Sonnet 5.5 继续通过 Anthropic、OpenRouter 提供。
- GPT-6 Luna 记录每百万 Token 的基础价格：缓存命中 $0.01、缓存写入 $0.125、输出 $0.50。MMSP 0.5.3 已能调用该模型；其 `none` 思考设置目前会发送为 `low`。

## 价格排序

模型页按缓存命中 85%、缓存未命中 10%、输出 5% 加权比较价格，计入当前促销和空闲时段折扣。升序时免费模型在前；无价格的模型在两个方向都排在最后。

## 已有 Project

**同步新增模型**添加新预设，保留已保存的旧模型和默认模型；**恢复默认**使用当前预设。退役 Go 条目遵循[目录保留规则](2026-10-14-backward-compatibility.zh.md)。
