# 登录过期或撤销后关闭 API socket

- **Date:** 2026-10-27
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1373](https://github.com/Prism-Shadow/penguin-harness/pull/1373)

[English](2026-10-27-socket-login-lifetime.md)

API socket 在平台重新加载后、发送响应或开始订阅前再次验证建立连接时的登录凭据。已开始的订阅在心跳时复核权限。这些检查不会延长登录有效期。
