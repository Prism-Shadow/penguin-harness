# 本机 API token 可签发短期远程浏览器会话

- **Date:** 2026-10-14
- **Type:** feature
- **Scope:** `server`
- **PR:** [#1139](https://github.com/Prism-Shadow/penguin-harness/pull/1139)

[English](2026-10-14-remote-session-exchange.md)

Penguin Remote 新增了用 Harness 本机 API token 换取短期浏览器会话 token 的接口。受保护的接口返回 cookie 名、新签发的原始 session token、过期时间和一小时会话的 max age，由远程代理自己在公网域名响应中设置 cookie。

## 细节

- `POST /api/remote/session` 仅接受现有本机 API token Bearer 路径认证的请求，拒绝了密码、桌面端、首次登录 setup 和 Remote Cookie 会话。
- 被拒绝的 Cookie 请求不会续期会话，也不会设置 Cookie；普通 API 请求仍保留现有的滑动续期行为。
- 签发出的浏览器会话通过常规 auth-session 仓库保存，带有内部 `remote` 来源标记。公开的 `sessionVia` 保持为 `token`，保留了本地 API token 的人工操作限制和 Agent 身份规则。敏感写操作需要另行使用密码登录。
- 只接受 token 的路由即使经过了外层路由的 Remote Cookie 认证，也要求实际的 Bearer 头；兑换得到的会话不能再次签发会话。
