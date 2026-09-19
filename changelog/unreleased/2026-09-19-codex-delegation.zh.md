# Codex 订阅任务委托插件

- **Date:** 2026-09-19
- **Type:** feature
- **Scope:** `skills`, `core`, `cli`, `desktop`
- **PR:** [#8](https://github.com/nicolaepocroianu/penguin-harness/pull/8)

[English](2026-09-19-codex-delegation.md)

新增了可选的 Use Codex 插件，通过 ACP 客户端和持续维护的 Codex ACP 适配器提供 MCP 工具。Penguin 保留父任务的控制权，由 Codex 处理明确委托的编程工作。

## 细节

- 新增了项目级 ChatGPT 设备登录、退出，以及通过未发送提示的 ACP 会话发现模型。
- 新增了任务启动、可恢复的会话 ID、基于游标的进度查询、取消及人工权限审批和表单答复。
- 将凭据保存在项目的 Codex 目录中，并从子进程环境中排除了宿主 API 密钥和桌面凭据。
- 将 ACP 运行时及其依赖与已安装技能分开打包，通过现有 Agent MCP 设置进行配置。
- 委托任务使用 workspace-write 和按需人工审批。普通工作区编辑可能无需额外确认。本集成不提供只读执行保证、自动审批模式或无限制模式。
- 本集成无法查询订阅限额，不为订阅任务虚构美元费用。
