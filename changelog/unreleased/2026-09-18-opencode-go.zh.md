# OpenCode Go：内置模型分组，排在 TokenDance 与 Penguin Go 之后

- **Date:** 2026-09-18
- **Type:** feature
- **Scope:** `model-catalog`, `web`, `docs`
- **PR:** [#786](https://github.com/Prism-Shadow/penguin-harness/pull/786)

[English](2026-09-18-opencode-go.md)

模型目录新增 **OpenCode Go** 分组（`opencode-go`），收录 OpenCode 为 Go 订阅列出的 27 个模型。模型库页面默认把它排在第三位：TokenDance、Penguin Go、OpenCode Go、DeepSeek，其余分组保持原有顺序。

## 细节

- 每个条目按 OpenCode 端点表给出的协议固定：16 条用 `openai-chat`、4 条用 `openai-responses`，都走 `https://opencode.ai/zen/go/v1`；其余 7 条用 `ant-messages`，走 `https://opencode.ai/zen/go`，因为 Anthropic 客户端会自行拼上 `/v1/messages`。手动添加进该分组的模型使用 `openai-chat` 与带 `/v1` 的 base URL。
- key 留空时，Chat Completions 与 Responses 条目读取 `OPENAI_API_KEY`，Messages 条目读取 `ANTHROPIC_API_KEY`。
- 价格取 OpenCode Go 页面列出的每 Token 美元价。Go 按月订阅、用量上限是美元额度，因此对这个分组而言，成本中心显示的是已用额度。`gpt-5.6-luna`、`grok-4.6`、`qwen3.7-plus` 与 `qwen3.6-plus` 记录基础档；四个 DeepSeek 条目记录高峰价，并沿用 DeepSeek 的空闲时段规则。所有条目都不带促销折扣。
- 上下文窗口与图像输入能力取自 OpenCode 维护的模型注册表 models.dev：16 个条目支持图像输入，11 个为纯文本。
- 在 key 所属的 OpenCode 工作区同意 Meta 用提示词和回复训练模型之前，`muse-spark-1.3-contributor` 与 `muse-spark-1.2-contributor` 返回 403；在其同意由中国境内托管的服务提供之前，`deepseek-v4.1-flash`、`deepseek-v4-flash` 与 `deepseek-v4-pro` 返回 403。从中国大陆访问时，`gpt-5.6-luna` 与两个 Muse Spark 模型因调用方所在地区返回 403。
- 该分组的端点位于 `opencode.ai`，因此发往它的请求都带有 `x-opencode-session`。
- 分组图标是 OpenCode Go 字标中的像素风「G」。
- 模型文档新增了介绍该分组的一节，配置文档列出了该分组的环境变量。
- 已有 Project 经模型库页面的「同步预置」获得该分组。分组被拖动成自定义顺序的 Project 保留原有顺序，新分组排在已排好的分组之后。
