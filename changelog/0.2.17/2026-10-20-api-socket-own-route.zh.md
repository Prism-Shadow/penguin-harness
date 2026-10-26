# API 套接字有了自己的路由

- **Date:** 2026-10-20
- **Type:** refactor
- **Scope:** `server`, `web`, `docs`
- **PR:** [#1272](https://github.com/Prism-Shadow/penguin-harness/pull/1272)

[English](2026-10-20-api-socket-own-route.md)

API 套接字从终端流的命名空间里搬了出来。它有了自己的一条 upgrade 路由 `GET /api/socket`：Cookie 指名用户，路由全程不碰终端管理器，所以不再有终端被顺带创建、列出或查询。

## 细节

- `apiSocketPath()` 不再接收参数，返回 `/api/socket`；`API_SOCKET_ID_PREFIX` 已删除。运行时的 upgrade 处理器自己匹配这条路径，像终端流一样校验会话 Cookie 与 `Origin`，然后把一个指名「Cookie 通过认证的那个用户」的引用交给平台——两种传输共用同一个 `attachStream`。
- 平台一侧照旧服务该协议：每次调用经 `Http.fetchAs` 进入当下的 App；流式应答变成 `stream`、`event` 与 `end` 帧；打开中的套接字在热更新之下对调用方不可见。
- Web App 用 `apiSocketPath()` 拼出套接字的地址。套接字以谁的身份打开由 Cookie 决定，页面这一侧的路径不再与用户 id 挂钩，也不再有任何终端 id 可供客户端伪造。

## 兼容性

- 没有任何已发布版本在旧路径上打开过 API 套接字：这个套接字（[每个标签页一个 API 套接字](2026-09-07-single-socket.zh.md)）从 0.2.17 起才随版本发布，地址是 `GET /api/socket`。只有 [#912](https://github.com/Prism-Shadow/penguin-harness/pull/912) 到本次改动之间的 `main` 构建用过 `GET /api/terminals/api-socket@<userId>/stream`。
- 该路径不再是一条 upgrade 路由：终端流处理器把这个 id 当作未知终端，以 `404` 拒绝握手。写死了它的客户端应改用 `@prismshadow/penguin-server/api` 的 `apiSocketPath()`。
- 0.2.16 及更早版本的机器在两条路径上都没有 API 套接字，把机器更新到 0.2.17 后才有。
