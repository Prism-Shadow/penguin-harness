# 网关把上游故障伪装成 4xx 时，不再直接结束本轮

- **Date:** 2026-10-16
- **Type:** fix
- **Scope:** `core`
- **PR:** [#1176](https://github.com/Prism-Shadow/penguin-harness/pull/1176)

[English version](2026-10-16-gateway-4xx-server-side.md)

网关把上游的瞬时故障伪装成任意 4xx（Console Go 对一条坏的上游 hop 报 400/403/413 都有）；
把那个状态码当真，会让一秒的抖动把一次正常会话直接杀死。现在 `isFatalProviderRejection`
在提供方自身声明了 server-side 故障、或完全没有响应体时，会继续走重试；
真正的致命拒绝（如 `invalid_request_error`、额度不足）仍然立即停止。
