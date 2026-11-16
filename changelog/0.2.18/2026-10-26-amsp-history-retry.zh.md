# 会话历史请求超时或限流后自动重试

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `amsp`
- **PR:** [#1332](https://github.com/Prism-Shadow/penguin-harness/pull/1332)

[English](2026-10-26-amsp-history-retry.md)

`SessionReader` 读取历史消息遇到 HTTP 408 或 429 时，会重试请求并保持实时消息流连接。历史请求成功后，历史消息与缓存的实时记录按顺序交付，并去除重复记录。401、403、404 等永久拒绝仍会停止监听；关闭监听器会取消尚未执行的重试。
