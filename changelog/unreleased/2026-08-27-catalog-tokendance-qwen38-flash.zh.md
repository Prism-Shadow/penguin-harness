# TokenDance 分组新增 Qwen 3.8 Flash

- **Date:** 2026-08-27
- **Type:** feature
- **Scope:** `core`
- **PR:** [#517](https://github.com/Prism-Shadow/penguin-harness/pull/517)

[English](2026-08-27-catalog-tokendance-qwen38-flash.md)

内置模型目录在 TokenDance 下新增 `qwen3.8-flash`，按该网关自己的价格：每百万 Token 输入 0.8 元、输出 2.7 元、缓存命中 0.1 元，上下文窗口 100 万 Token，支持图片输入。

同一个上游 id 早已存在于 Qwen 按量付费分组中，用的是 Qwen 官方直连价（1 / 3 / 0.1 元）。两条都保留：同一个模型有两条到达路径，价格由卖它的一方决定，而网关在输入与输出上都更便宜。

## 细节

- 上下文窗口与视觉标记取自 TokenDance 的公开目录接口（`GET https://tokendance.space/gateway/v1/models`，无需凭据），与该分组其余各行的核对来源一致。
- 该行没有折扣：其目录 `description` 中没有方括号的「限时」标记——这一点与同组的 `qwen3.8-max` 不同——因此列表价与实际计费一致。
- 它声明的协议集是本组最宽的：`openai:chat-completions`、`openai:responses` 与 `anthropic:messages`。`openai-chat` 是本分组的约定，而非该 id 唯一能走的形态，条目里写明了这一点，以免日后被误读成硬性限制。
- `cache_write` 承载输入价，这是整个 TokenDance 区块既有的约定：该网关只公布输入价与缓存命中价，没有单独的缓存写入费。
