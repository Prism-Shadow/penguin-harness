# 桌面端也能走完授权新建 API key 的跳回

- **Date:** 2026-08-26
- **Type:** fix
- **Scope:** `server`, `docs`
- **PR:** [#502](https://github.com/Prism-Shadow/penguin-harness/pull/502)

[English](2026-08-26-model-oauth-desktop-callback.md)

TokenDance 的**授权新建 key** 在桌面端会以 `unauthorized`（"Not signed in or the sign-in has expired."）失败，同样的操作在浏览器里却能完成。此前每一次桌面端授权都在处理函数运行前就以 401 结束：授权页在系统浏览器中打开，供应商跳回的也是**那个**浏览器，而它并不持有 `http://localhost:<port>` 的 `penguin_session` Cookie。跳回地址不再要求会话——同时也不再自行兑换任何东西，这样这条无需会话即可应答的路由就始终没有写入凭据的权限。

## 细节

- 把 `GET /api/projects/:projectId/model-oauth/callback` 挂载到全局认证中间件之前，改以 flow id 而非会话 Cookie 授权：服务端铸造的 32 字节随机数，绑定着一个用户、一个 Project、一个供应商，以及一个从不离开本进程的 PKCE verifier，有效期十分钟。
- 把兑换拆成两步。跳回地址只把授权码存到流程上并回以"Authorization received"；与供应商的兑换、以及写入该 Project 模型的动作，都挪到了 `GET /:flowId`——Owner 自己的轮询，仍在认证之后。兑换失败也改为在那里以 `{status: error, error}` 抵达对话框，而不再显示在跳回页面上。
- 每个流程只留一个存放授权码的位置，并拒绝为 `mode: manual` 开启的流程存入——该模式压根不下发跳回地址，选用它的部署也就从未同意过多出一条无需会话的入口。存下的授权码与 PKCE verifier 都在兑换的第一个 `await` 之前被取走，因此两个跳回相争只会存入一次，两个轮询相争也只会兑换一次。
- 跳回路径上的 `HEAD` 返回 405：Hono 会在路由之前把 HEAD 改派为 GET，否则一个 HTTP 要求必须安全的方法就能把流程的存入名额用掉。
- 豁免范围严格限于这一条字面路径。`/start`、`/:flowId/code` 与状态查询路由维持仅限 Owner，字面路径注册在前，也使 `:flowId` 不会匹配到 `callback`。
- 删除了没有任何调用方的 `ModelOAuthService.providerOf`。
- 在 Server API 与模型文档中以双语记录了这条跳回地址、它确切的豁免范围，以及两步兑换。
