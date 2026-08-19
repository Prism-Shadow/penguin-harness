# 模型：qianwenai 阵容刷新、DeepSeek flash 修订，以及以 flash 作为预置默认

- **Date:** 2026-08-03
- **Type:** feature
- **Scope:** `model-catalog`, `docs`, `skills`
- **PR:** [#160](https://github.com/Prism-Shadow/penguin-harness/pull/160)

[English](2026-08-03-model-catalog-qianwenai-flash.md)

价格与规格于 2026-08-03 读取自各模型页面或网关的 models API。

## qianwenai 分组

Qwen Pay-As-You-Go 新增 `qwen3.8-max`（每百万 Token CNY 1.5/12/36，支持视觉）与 `deepseek-v4-flash-0731`（CNY 0.2/1/2，纯文本；该页面把 DeepSeek 列为不带前缀的形式，与带 `kimi/` 和 `ZHIPU/` 前缀的转售不同），并移除 `qwen3.7-max`。Qwen Token Plan 新增同样这两个模型，并移除 `qwen3.8-max-preview` 与 `qwen3.7-max`，而 `deepseek-v4-pro`、`glm-5.2` 与 `qwen3.7-plus` 保留；预览条目既已移除，Token Plan 的模型页链接就不再需要它那处特例回退。

## OpenRouter

新增 `deepseek/deepseek-v4-flash-0731` 与 `openai/gpt-5.6-luna`，并移除 `poolside/laguna-m.1:free`——models API 已不再列出它（只剩 `laguna-s-2.1` / `laguna-xs-2.1` 这一代）。每一个 OpenRouter 行的定价也在一次遍历中从 models API 重新读取，这正是目录注释自 2026-07-20 起就记下的那笔欠账：`cache_read` 现在在有公布缓存命中价的地方存储该价格；`cache_write` 在 Anthropic/GPT 行上存储真实的 1.25× 逐 Token 写入溢价，其余则存储输入价（Gemini 的 API 字段是按小时的存储费率，而非逐 Token 价格，因此那些行保留输入价）；而已漂移的输入/输出牌价跟随 API 更新（`moonshotai/kimi-k2.6`、`openai/gpt-5.6-terra`、`tencent/hy3`、`z-ai/glm-5.2`，以及未标日期的 `deepseek/deepseek-v4-flash`）。

## SiliconFlow

此前三个未定价的行（`Pro/moonshotai/Kimi-K2.6`、`Pro/zai-org/GLM-5.1`、`Qwen/Qwen3.6-35B-A3B`）拿到了它们的官方人民币牌价；GLM-5.1 按两档输入长度计费，目录存储较低的那一档，并标注为长上下文使用时的下限。目录中已不再有任何未定价的条目。

## 默认模型、文档与 Skill

预置的 Project 默认变为 `deepseek` / `deepseek-v4-flash`。文档随之更新（models / configuration / quickstart，中英）；penguin-sdk skill（v18）点名了它那条纯环境变量配置路径所依赖的新预置默认，agenthub-models（v9）则补上了 `deepseek/deepseek-v4-flash-0731` 这个 OpenRouter 写法；而已发布的、提到被移除免费模型的博客文章保持冻结。

## 对已有 Project 的影响

不存在自动迁移：模型条目与默认值是在 Project 创建时被复制进 `.project_config.toml` 的，升级时没有任何东西会重写它们。Web 端的「同步预设」操作在用户显式执行时，会按目录顺序追加仅目录中存在的行，并更新与预设匹配的行中由目录掌管的字段（视觉、上下文窗口、客户端类型、定价、base URL）——凭证与列表位置予以保留，任何东西都不会被删除，已存的默认值也不受触碰；被下架的预设只是不再被重新添加。只有新创建的 Project 才会开箱看到新的阵容与默认值。
