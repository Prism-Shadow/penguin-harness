# TokenDance 分组新增 Doubao Seed 模型

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `model-catalog`, `docs`

[English](2026-09-02-doubao-seed-models.md)

内置目录的 TokenDance 分组新增字节跳动的三个 Doubao Seed 对话模型：`seed-2.1-pro`（Doubao Seed 2.1 Pro）、`seed-2.1-turbo`（Doubao Seed 2.1 Turbo）与 `seed-evolving`（Doubao Seed Evolving，一个滚动更新的 id，当前与 2.1 Pro 为同一模型）。三者都在该网关的五折促销中，按 TokenDance 促销条目的既有口径记录——`pricing` 存牌价、`discount` 存折扣率——因此模型页显示实际计费价并带折扣徽标，预置进 Project 的价格即网关实际收取的价格。

## 细节

- 计费价（CNY / 百万 Token，输入 / 输出 / 缓存命中）：2.1 Turbo 1.5 / 7.5 / 0.3；2.1 Pro 与 Evolving 3 / 15 / 0.6。上下文窗口 256K，支持图片输入，与该分组其他条目一样固定 `openai-chat` 客户端与分组预置 base URL。
- 既有 Project 通过模型页的**同步预置**获得这些条目；新建 Project 创建时即带上。
- `models` 文档页列出了新条目与该分组当前九个折扣中的模型。
