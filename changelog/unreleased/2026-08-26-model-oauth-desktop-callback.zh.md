# 桌面端也能走完授权新建 API key 的跳回

- **Date:** 2026-08-26
- **Type:** fix
- **Scope:** `server`, `docs`

[English](2026-08-26-model-oauth-desktop-callback.md)

TokenDance 的**授权新建 key** 在桌面端会以 `unauthorized`（"Not signed in or the sign-in has expired."）失败，同样的操作在浏览器里却能完成。跳回地址不再要求会话，两端因此都能走完整个流程。

## 细节

- `GET /api/projects/:projectId/model-oauth/callback` 改为挂载在全局认证中间件之前，凭 flow id 而非会话 Cookie 授权。桌面端 shell 会把所有非本应用的 URL 交给 `shell.openExternal`，授权页因而在系统浏览器中打开，供应商跳回时跳的也是**那个**浏览器——它并不持有 `http://localhost:<port>` 的 `penguin_session` Cookie；在认证中间件之后，每一次桌面端授权都在处理函数运行前就以 401 结束。
- `ModelOAuthService.complete` 接受为 null 的 `userId`，它只豁免流程的用户校验，别的一概不放过：请求仍必须指向该流程自己的 Project、落在十分钟 TTL 之内、且是该流程的第一次兑换——而它所出示的 flow id 是服务端铸造的 32 字节随机数，绑定着一个从不离开本进程的 PKCE verifier。
- 豁免范围严格限于这一条字面路径与 `GET` 方法。`/start`、`/:flowId/code` 与状态查询路由维持原样，仍然仅限 Owner；`/callback` 之下更长的路径、以及该路径上的其它请求方法，也仍在认证之后。字面路径注册在前，同时使 `:flowId` 状态路由不会再匹配到 `callback`。
- 已登录的浏览器标签页走同一条跳回不受影响：那里根本不会去读这个 Cookie。
- Server API 文档以双语记录了该豁免及其确切范围。
