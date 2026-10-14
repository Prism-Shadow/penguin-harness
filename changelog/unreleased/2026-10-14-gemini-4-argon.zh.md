# Google、Penguin Go 和 OpenRouter 新增 Gemini 4 Argon

- **Date:** 2026-10-14
- **Type:** feature
- **Scope:** `model-catalog`, `core`, `cli`, `docs`
- **PR:** [#1127](https://github.com/Prism-Shadow/penguin-harness/pull/1127)

[English](2026-10-14-gemini-4-argon.md)

在 Google、Penguin Go 和 OpenRouter 分组新增了 Gemini 4 Argon 预置，并将 MMSP 升级到 0.5.3。

## 模型与价格

- Google 和 Penguin Go 使用 `gemini-4-argon`，OpenRouter 使用 `google/gemini-4-argon`。三者均支持图像输入，输入与输出共享 1,048,576 Token 的上下文窗口。
- Google 和 OpenRouter 记录的牌价为每百万 Token 输入 4 美元、输出 20 美元、缓存命中 0.20 美元，并单独声明持续至 2026 年 11 月 30 日的首发 5 折。
- Penguin Go 的牌价为每百万 Token 输入 2 美元、输出 10 美元、缓存命中 0.10 美元。额外促销由平台在连接或**同步模型**时下发。
- MMSP 0.5.3 在 Google 客户端上将 Argon 的思考等级 `none` 映射到 `low`，`xhigh` 和 `max` 映射到 `high`，`low`、`medium` 和 `high` 保持原值。同步输出最多支持 65,536 个 Token，包含思考。

## 已有 Project

在模型库页面点击**同步新增模型**即可补齐预置。已有模型、凭据、分组设置和默认模型保持原有配置。
