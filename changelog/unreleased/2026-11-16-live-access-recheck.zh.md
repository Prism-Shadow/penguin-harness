# 打开着的 Session 流与 API socket 会重新检查访问权限

- **Date:** 2026-11-16
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1359](https://github.com/Prism-Shadow/penguin-harness/pull/1359)

[English](2026-11-16-live-access-recheck.md)

打开着的 Session 流（`/stream`、`/amsp` 与 Agent API 的 `/amsp/v1/sessions/:id/stream`，经 HTTP 或 API socket）在每次心跳时重新执行其路由的访问检查，与原有的登录复查一致。成员被移出 Project、Agent API 密钥被删除、无密钥访问被关闭、Agent 或服务端 API 被停用后，该流在一个心跳内结束；其他读者保持连接。

API socket 始终绑定其握手时认证的登录。该登录失效后——退出登录、被管理员重置或过期——socket 的下一次调用或下一次心跳即以代码 `1008` 关闭它并释放其调用；重新登录即可再次连接。检查不会延长登录的有效期。
