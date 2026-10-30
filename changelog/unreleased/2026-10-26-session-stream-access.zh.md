# 持续检查会话订阅权限

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1359](https://github.com/Prism-Shadow/penguin-harness/pull/1359)

[English](2026-10-26-session-stream-access.md)

会话订阅现在会在发送事件前和每次心跳时重新检查权限，覆盖 HTTP 和 API Socket 两种传输方式。移除项目成员会结束其已有订阅。删除密钥、关闭免密访问、关闭 Agent API 或服务端 API，也会结束对应的 Agent API 订阅。其他仍有权限的订阅者保持连接。
