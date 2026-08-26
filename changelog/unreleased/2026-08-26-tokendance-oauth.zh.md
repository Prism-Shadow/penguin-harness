# 在模型页授权新建 TokenDance API key

- **Date:** 2026-08-26
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`, `model-catalog`
- **PR:** [#470](https://github.com/Prism-Shadow/penguin-harness/pull/470)

[English](2026-08-26-tokendance-oauth.md)

TokenDance 分组头部新增**授权新建 API key** 动作：经供应商的授权页在用户的 TokenDance 账户下新建一个 key，并写入该分组下的每一个模型，首次配置不必再去控制台手动复制。

## 细节

- 内置目录的 `ModelProviderInfo` 新增可选的 `oauth` 描述（授权页、兑换端点、记在新 key 上的名称），配置在 `tokendance` 条目上。Web App 对任何声明了该描述的分组渲染这一动作；服务端也只对这类分组受理流程，且两个 URL 一律取自目录，不取自请求。
- `APP_URL` 改为由模型目录导出，作为流程的 `app_url` 发送——在这里新建的 key 因此被打上与归因请求头相同的应用 URL。
- 新增四个仅限 owner 的路由，位于 `/api/projects/:projectId/model-oauth`：`POST /start` 开启流程并返回要跳转的页面，`GET /callback` 是 TokenDance 跳回的地址，`GET /:flowId` 报告流程结果，`POST /:flowId/code` 兑换用户粘贴的授权码。回调返回一个自包含的小 HTML 页面，而非 JSON。
- PKCE 的 verifier 在服务端生成、在内存中保留十分钟，从不下发到客户端；新建出的 key 直接写入该分组的模型，不经过浏览器，也不出现在任何响应、日志、URL 或错误信息中。一次流程只属于某个 Project 下的某个用户，且只能兑换一次。
- 回调地址由请求自身的 URL 推导，因此环回地址、局域网地址与自定义端口都无需额外配置即可工作；`x-forwarded-proto` 与 `x-forwarded-host` 仅在 `PENGUIN_TRUST_PROXY=1` 时采信。
- 手动模式不传回调地址，授权页改为显示一次性授权码，适用于桌面端外壳以及跳转回不来的部署。对话框在跳转路径之外一并提供该入口。
- 流程完成后会使该 Project 已缓存的 Session 运行时失效并发布 `credentials_updated`，与模型 PUT 的后续动作一致。
- Server API 与模型文档以中英双语记录了这些路由与用户侧流程。

## 兼容性

磁盘上已有的数据形态不变：`oauth` 描述只存在于代码侧的目录中，新建出的 key 也按其余凭据写入路径一贯的 `api_key` / `created_at` 存放。没有任何配置文件、数据库或本地偏好需要迁移。

已有的 Project 不会自行获取目录变更——预设在创建 Project 时被复制进 `.project_config.toml`，此后只有模型页的「同步预设」会更新它们。因此，只要 Project 的模型表中已有 TokenDance 条目，该动作就会出现；早于该分组的 Project 需要先同步一次预设，分组与这个新动作才会显示。
