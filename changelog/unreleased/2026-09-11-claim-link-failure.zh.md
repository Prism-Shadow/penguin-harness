# 用过的一次性登录链接回到登录页，不再甩出 JSON 报错

- **Date:** 2026-09-11
- **Type:** fix
- **Scope:** `server`, `web`, `docs`

[English](2026-09-11-claim-link-failure.md)

打开一条已被使用或已失效的一次性登录链接时，浏览器收到的是 `{"error":{"code":"unauthorized",…}}`，
用户停在一页原始 JSON 上，无从下手。`GET /api/auth/claim` 现在把这类兑换重定向到 `/login`，Web App
在常规登录表单之上弹出对话框，说明发生了什么、以及如何拿到可用的链接。

## 细节

- 重定向带上 `?claimFailed=desktop` 或 `?claimFailed=server`，取值由服务端是否由桌面壳拉起决定。桌面
  文案让用户重启应用——重启即生成新链接并自动登录；服务端文案指向下方的账号密码表单与服务器管理员。
  两种 token（壳的一次性 token 与首次登录链接）在同一服务端上的拒绝答复仍然逐字节相同。
- 登录页在弹出对话框后以一次 history replace 清掉该参数：刷新不会再次弹出，复制出去的地址也不带它。
- `server-api` 文档在成功路径之外补记了失败重定向。
