# 内置 MiniMax M3 模型预设

- **Date:** 2026-08-18
- **Type:** feature
- **Scope:** `core`, `web`, `docs`, `model-catalog`
- **PR:** [#167](https://github.com/Prism-Shadow/penguin-harness/pull/167)

[English](2026-08-18-minimax-m3-preset.md)

内置模型目录新增一个 MiniMax Provider 分组，内含一个直连的 `MiniMax-M3` 预设，只需填入 API key 即可使用。

## Core

新的 `minimax` 分组（标签为 "MiniMax"，排在 Moonshot 与 Custom 之间）收录 `MiniMax-M3`，支持 1,000,000 Token 上下文与视觉输入。该预设固定使用 AgentHub 的 `minimax-m3` Responses 客户端，并内联直连端点 `https://api.minimax.io/v1`，因此本身不含任何密钥。MiniMax 的两种计费模式共用这一个端点——分组的取 key 链接指向按量付费的 API key 页面，Token Plan Subscription Key 同样可用——所以这里只设一个 `minimax` 分组，而不像 Qwen 那样需要按计费模式拆分。

价格记录的是 MiniMax 按量付费标准档、输入不超过 512K Token 的费率：每百万 Token 缓存读取 $0.06、输入 $0.30、输出 $1.20。输入超过 512K 后各档费率翻倍，priority 档另为 1.5 倍，因此长上下文与 priority 用量会被低估；这与目录对 OpenAI（>272K）和 Gemini 3.1 Pro（>200K）已经采用的基准档口径一致。环境变量回退与 AgentHub 的精确路由保持一致：只有搭配 `minimax-m3` 客户端的 `MiniMax-M3` 才会解析到 `MINIMAX_API_KEY` / `MINIMAX_BASE_URL`；形似的以及不受支持的 MiniMax id 仍然无法路由。

Core 与 CLI 升级到 `@prismshadow/agenthub` ^0.4.2，这是首个提供 `minimax-m3` Responses 客户端的版本。

## Web App

Provider 图标集新增 MiniMax 官方的流线标识，扁平化为 currentColor 单色——与其他厂商品牌标识采用同样的识别用途处理方式。模型对话框的 base URL 协议提示已知晓 M3 客户端请求的是 `{base}/responses`，而非其他所有非 OpenAI、非 Anthropic、非 Gemini 客户端使用的 `/chat/completions`。

## Docs

中英文模型与配置页面记录了这个新分组、它的凭证解析方式、省略的阶梯定价，以及 M3 的思考等级映射——其中 `none` 对应 `reasoning.effort = "none"`。
