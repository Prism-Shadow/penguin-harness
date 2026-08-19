# 模型：OpenRouter 新增 qwen/qwen3.8-max

- **Date:** 2026-08-04
- **Type:** feature
- **Scope:** `model-catalog`, `skills`
- **PR:** [#178](https://github.com/Prism-Shadow/penguin-harness/pull/178)

[English](2026-08-04-model-catalog-openrouter-qwen38-max.md)

价格与规格于 2026-08-04 读取自 OpenRouter 的 models API。

OpenRouter 分组新增 `qwen/qwen3.8-max`——每百万 Token 输入/输出 USD 2/6，缓存读取采用公布的 0.25 命中价，缓存写入采用真实的 2.5（1.25× 输入）溢价，上下文窗口 1,000,000，支持视觉——按同系列最新在前的顺序，插在 `qwen/qwen3.6-35b-a3b` 之前。该区块的来源注释现在把它计入那些携带真实缓存写入溢价的行。目录本就通过 qianwenai 的转售分组收录了这个模型；这次新增的是它的 OpenRouter 写法，配 OpenRouter 自己的美元价格。

agenthub-models skill（v10）新增一行 Qwen 3.8 Max 并记录其 OpenRouter id——目录中没有其他网关转售它，因此那一列是孤立的一项。

与每次目录新增一样，不存在自动迁移：已有 Project 保留其已存的模型表，通过模型页显式的「同步预设」操作来取得该行；新建 Project 则开箱可见。
