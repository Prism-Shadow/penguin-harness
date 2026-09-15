# 目录中的 DeepSeek V4 Flash 恢复为纯文本

- **Date:** 2026-09-11
- **Type:** fix
- **Scope:** `model-catalog`, `core`, `docs`
- **PR:** [#678](https://github.com/Prism-Shadow/penguin-harness/pull/678)

[English](2026-09-11-deepseek-v4-flash-text-only.md)

DeepSeek 直连分组的 `deepseek-v4-flash` 条目标记为纯文本（`supportsVision: false`）。DeepSeek 已于
2026-09-10 将该 id 退役并改由 V4.1 Flash 承接，但 AgentHub 0.4.11 的 DeepSeek 客户端会用纯文本
拒绝名单 `/^deepseek-v4-(flash|pro)(-\d{4})?$/` 匹配这个裸 id，在请求离开 harness 之前就拒绝图像
部件，因此挂给该模型的图片根本到不了 DeepSeek。

## 细节

- `deepseek-flash`（V4.1 Flash）与 `deepseek-v4-flash-vision-exp` 保持不变，仍支持图像输入；
  OpenRouter、TokenDance 与 vLLM 上转售的 V4.1 Flash 和 Vision Exp 条目同样不变。
- 文档站的模型页随该条目一并更正。
- 已有 Project 仍保留 `.project_config.toml` 中已存的 `vision` 取值；在模型页点击**同步预置**即可
  应用这次更正。
