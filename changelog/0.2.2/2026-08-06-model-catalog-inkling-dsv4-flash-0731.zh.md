# 模型：Inkling 与 Fireworks 上的 DeepSeek V4 Flash 0731 加入；网关的 GLM-5.1 下架

- **Date:** 2026-08-06
- **Type:** feature
- **Scope:** `model-catalog`, `skills`, `docs`
- **PR:** [#220](https://github.com/Prism-Shadow/penguin-harness/pull/220), [#230](https://github.com/Prism-Shadow/penguin-harness/pull/230)

[English](2026-08-06-model-catalog-inkling-dsv4-flash-0731.md)

价格与规格于 2026-08-06 读取自各模型的 Provider 页面。

## 新增模型

Thinking Machines Lab 的 Inkling（2026-07-14 发布：1M 上下文，多模态图像 + 音频输入）在两个网关上加入：OpenRouter 的 `thinkingmachines/inkling`（每百万 Token 缓存 $0.17 / 非缓存输入 $1 / 输出 $4.05，读取自 models API——当模型的网页与 API 不一致时以 API 为准）与 Fireworks AI 的 `accounts/fireworks/models/inkling`（缓存 $0.17 / 非缓存输入 $1 / 输出 $4.05）。Fireworks AI 还新增 `accounts/fireworks/models/deepseek-v4-flash-0731`（$0.028 / $0.14 / $0.28），按同系列最新在前的排序规则置于未标日期的 flash 行之前。

## 下架

OpenRouter 的 `z-ai/glm-5.1` 与 SiliconFlow 的 `Pro/zai-org/GLM-5.1` 网关条目被移除；Z.AI 直连的 `glm-5.1` 保留。已有 Project 配置照常工作——模型条目是在创建时被复制进 `.project_config.toml` 的，升级时没有任何东西重写它们；被下架的预设只是不再被模型页的「同步预设」操作重新添加。

## OpenRouter 价格刷新（2026-08-07）

后续从 models API 对整个 OpenRouter 分组做的一次遍历重读，也刷新了自 2026-08-03 以来发生漂移的那些行：`deepseek/deepseek-v4-flash`（$0.01764 / $0.0882 / $0.1764）、`moonshotai/kimi-k2.6`（$0.0992 / $0.589 / $2.48）、`qwen/qwen3.6-35b-a3b`（缓存读取 $0.05，现已公布）与 `z-ai/glm-5.2`（$0.1261 / $0.679 / $2.134）。没有任何一行携带缓存写入溢价；「未公布缓存价则回退」的规则现在只覆盖 `:free` 行。（`inclusionai/ling-3.0-flash:free` 已不再出现在 API 列表中——暂留在目录中，等待下架决定。）

## 文档与 Skill

agenthub-models skill（v11）新增 Inkling 与 Fireworks 0731 的写法，并不再点名已下架的 GLM-5.1 网关 id；README（中英）的支持模型表新增 Inkling 系列（OpenRouter、Fireworks AI）。
