# JellyToken 模型分组

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `model-catalog`, `web`, `docs`

[English](2026-11-19-jellytoken-provider.md)

新增九个共用分组密钥的 JellyToken 对话模型预设。新项目自带这些预设，已有项目的所有者可通过**同步新增模型**添加，不会改变默认模型。

## 细节

- 分组通过 `https://aiservice.jellytoken.com/v1` 调用 Chat Completions。密钥管理、模型列表和模型 ID 入口均打开 `https://www.jellytoken.com/models?utm_source=penguin-harness`。
- 九个预设均配置了 1M 上下文窗口。「几折起」标签只用于展示，不改变成本中心的费率。
