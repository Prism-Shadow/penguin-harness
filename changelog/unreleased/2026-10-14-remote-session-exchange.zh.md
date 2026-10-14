# 本机 API token 可签发短期远程浏览器会话

- **Date:** 2026-10-14
- **Type:** feature
- **Scope:** `server`
- **PR:** [#1139](https://github.com/Prism-Shadow/penguin-harness/pull/1139)

[English](2026-10-14-remote-session-exchange.md)

Penguin Remote 现在可以用 Harness 的本机 API token 换取一个短期浏览器会话 token。新的受保护接口会返回 cookie 名、新签发的原始 session token、过期时间和一小时会话的 max age，由远程代理自己在公网域名响应中设置 cookie。

## 细节

- `POST /api/remote/session` 只接受现有本机 API token Bearer 路径认证的请求。密码、桌面端和首次登录 setup Cookie 会话都会被拒绝。
- 被拒绝的 Cookie 请求不会续期会话，也不会设置 Cookie；普通 API 请求仍保留现有的滑动续期行为。
- 签发出的浏览器会话仍通过常规 auth-session 仓库保存，并带有内部 `remote` 来源标记，便于后续审计和吊销时区别于普通密码会话。
