# 登录过期或撤销后关闭 API socket

- **Date:** 2026-10-27
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1373](https://github.com/Prism-Shadow/penguin-harness/pull/1373)

[English](2026-10-27-socket-login-lifetime.md)

API socket 持续绑定握手时使用的登录凭据。密码重置、退出登录或登录过期后，该连接不能继续调用接口或接收流消息。下一次请求、出站事件或心跳会关闭失效连接并释放其请求，重新登录后可以正常连接。

检查现有连接不会延长登录有效期。

登录失效后，请求会在进入已释放的 App 前被拒绝。App 重建后，新的登录可以正常建立新连接。
