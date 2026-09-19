# Codex 订阅任务委托插件

- **Date:** 2026-09-19
- **Type:** feature
- **Scope:** `skills`, `core`, `cli`, `desktop`
- **PR:** [#8](https://github.com/nicolaepocroianu/penguin-harness/pull/8)

[English](2026-09-19-codex-delegation.md)

新增了可选的 Use Codex 插件，通过 MCP 桥接官方 Codex app-server。Penguin 保留了父任务的控制权，由 Codex 处理明确委托的编程工作。

## 细节

- 新增了项目级 ChatGPT 设备登录和退出、账户限额查询及模型发现。
- 新增了任务启动、可恢复的线程 ID、基于游标的进度查询、取消以及人工审批和输入转发。
- 将凭据保存在项目的 Codex 目录中，并从子进程环境中排除了宿主 API 密钥和桌面凭据。
- 通过现有插件库和 Agent MCP 设置提供了配置说明，默认只读执行，编辑任务需明确选择 workspace-write。
