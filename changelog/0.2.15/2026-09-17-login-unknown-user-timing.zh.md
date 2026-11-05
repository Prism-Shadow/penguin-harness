# 不存在的用户名登录时，与密码错误付出同样的 scrypt 校验

- **Date:** 2026-09-17
- **Type:** fix
- **Scope:** `server`
- **PR:** [#774](https://github.com/Prism-Shadow/penguin-harness/pull/774)

[English](2026-09-17-login-unknown-user-timing.md)

用不存在的用户名登录时，服务端不跑 scrypt 就直接返回；真实账号输错密码，却要完整做一次派生。在生产强度下，前者远不到 1 毫秒就有回应，后者要几十毫秒，响应时间因此暴露了哪些用户名存在。现在不存在的用户名会拿一个占位 hash（dummy hash）校验，两种失败都在一次派生之后返回同样的 401 `invalid_credentials` 响应体。

## 细节

- `verifyAccountPassword` 每次调用恰好执行一次 scrypt 派生。账号不存在、hash 为空，或 hash 无法校验（格式错误，或参数被 scrypt 拒绝）时，它改为拿占位 hash 校验密码，并判定登录失败。
- `AuthService.login` 用服务端自己的密码哈希器生成占位 hash，因此它与真实 hash 的代价参数相同。占位 hash 在第一次需要时计算，之后一直保留。
