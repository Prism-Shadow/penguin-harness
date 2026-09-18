# Copilot 模型目录路由与 Responses 支持

- **Date:** 2026-09-19
- **Type:** fix
- **Scope:** `core`, `server`, `docs`

[English](2026-09-19-copilot-responses.md)

更新了开发用 AgentHub 适配器补丁，以请求 Copilot 的 agentic-workflows 模型目录，并支持声明使用 Responses API 的模型。

## 细节

- 根据模型元数据选择 Responses 或 Chat Completions，并为每个模型客户端保持协议选择稳定。
- 保留了 Penguin 对工具执行、审批、历史记录、取消和重试的管理。
- 排除了策略明确禁用的模型，并将凭据范围保持在项目内。
