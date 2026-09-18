# 实验性 Copilot 订阅连接

- **Date:** 2026-09-19
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `model-catalog`, `docs`

[English](2026-09-19-copilot-subscription.md)

在模型页面添加了项目级 GitHub Copilot 设备登录流程。连接后导入了可访问且支持工具调用的 Chat Completions 模型，并通过现有模型配置保存凭据。

## 细节

- 将模型传输保留在 AgentHub 中，将工具执行、审批、上下文和历史记录保留在 Penguin 中。
- 添加了服务端轮询限制、所有权检查、过期处理、取消、重新连接和本地凭据清除。
- 要求通过 `PENGUIN_COPILOT_CLIENT_ID` 明确配置 GitHub OAuth 应用，未复用其他应用的身份。
- 将订阅价格保留为未知，并推迟了仅支持 Responses 的模型、会过期的 GitHub App 凭据、ChatGPT 订阅和 ACP。
- 添加了固定版本的开发依赖补丁，等待 AgentHub 发布。npm 分发以及自定义 OAuth 应用的实际访问能力仍未验证。
