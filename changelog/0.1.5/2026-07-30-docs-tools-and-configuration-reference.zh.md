# 文档：工具与配置参考重新与代码一致

- **Date:** 2026-07-30
- **Type:** process
- **Scope:** `docs`
- **PR:** [#126](https://github.com/Prism-Shadow/penguin-harness/pull/126)

[English](2026-07-30-docs-tools-and-configuration-reference.md)

有三处参考区块落后于它们所描述的代码

`run_subagent` 的参数区块只列出了 `model_id`，然而模型始终以完整的 `(provider, model_id)` 二元组引用：该工具的 schema 同时声明了两者，并会拒绝只带其中一个的调用，而页面自己的正文其实已经这么写了。落后的只有代码块，而那恰恰是读者会复制的部分——现在两个语言版本都在 `model_id` 旁列出了 `provider`。

Provider 凭证表只覆盖了 `MODEL_PROVIDERS` 中十二个分组里的九个，遗漏了 `fireworks`、`qwen-token-plan` 与 `qwen-pay-as-you-go` 三个网关。这三者读取的都是 `OPENAI_API_KEY` / `OPENAI_BASE_URL`，原因与 `openrouter`、`siliconflow` 早已列在那一行上是一样的：网关的模型 id 无法被自动路由，因此其条目走 OpenAI 客户端。对于表中缺失的分组，人们自然而然的猜测会错两次，因为无论是形似厂商的 `FIREWORKS_API_KEY`，还是该网关所转售模型对应厂商的变量，都不会被读取。

Project 模型条目表漏掉了 `max_tokens`，也就是那个在设置后会覆盖 Agent 的 `model.max_tokens` 的逐模型输出上限。正是它才让窄上下文模型变得可用——Agent 预置的默认值 32000 在小窗口里根本容不下它加上任何提示词，而上游会直接拒绝这样的请求——而 CLI 参考早已记录了写入该值的那个参数。
