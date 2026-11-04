# Penguin Remote 会话算作人的登录

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `server`, `docs`
- **PR:** [#1337](https://github.com/Prism-Shadow/penguin-harness/pull/1337)

[English](2026-10-26-remote-session-counts-as-person.md)

经 Penguin Remote 打开的浏览器无法生成 Chrome 配对码：服务器以 `human_required` 拒绝（"Sign in with your password to do this; an API token or its Remote session cannot."），原因是 Penguin Remote 用本地 API token 兑换的一小时会话（`POST /api/remote/session`，见[会话兑换](../0.2.16/2026-10-14-remote-session-exchange.zh.md)）沿用了 token 的权限。现在这个会话算作人的登录，经 Penguin Remote 使用 Web App 与在本机登录时表现一致。

## 细节

- `/api/me` 对这个会话返回 `sessionVia: "remote"`，不再是 `"token"`；`"token"` 只表示以 Bearer 头出示的本地 API token 本身。
- 所有需要人的登录的写操作都接受 Remote 会话：配对 Chrome、选择浏览器后端、Agent 的 API 开关、无密钥访问、审批模式、密钥与「试一试」，以及管理员的 `agentApiEnabled`。Bearer token 仍以 `403` `human_required` 拒绝，提示文字改为 "This takes a person's sign-in; the local API token cannot do it."
- 身份规则把 Remote 会话当作普通的 Cookie 会话：它携带的 `sessionId` 或 `agentId` 不会被当作 Agent 的身份声明，它发起的运行把管理员记为驱动者，浏览器路由以管理员身份执行，并采纳 Web App 发来的 `projectId`。
- 不变的部分：`POST /api/remote/session` 仍只接受 Bearer，Remote Cookie 依旧不能再兑换会话；会话仍在签发一小时后到期；它打不开只属于桌面应用自己窗口的路由；用它修改密码仍需提供当前密码。
- 持有本地 API token 的 Agent 可以兑换一个 Remote 会话来通过这些检查。安全与服务器 API 文档把这一点与 token 既有的限制写在一起：这些限制是收窄，不是边界。
