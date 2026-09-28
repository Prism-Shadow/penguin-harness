# 每个请求只记一行日志

- **Date:** 2026-09-28
- **Type:** fix
- **Scope:** `server`
- **PR:** [#875](https://github.com/Prism-Shadow/penguin-harness/pull/875)

[English](2026-09-28-request-logged-once.md)

服务器日志此前把每个 HTTP 请求记成两行：静态文件先记 `GET /penguin-logo.svg 404 0ms`、再记 `GET /penguin-logo.svg 200 4ms`，而浏览器始终只收到那个 200。这是同一个请求，被它依次经过的两个应用各记了一遍：平台应用先记，对静态文件而言那一行记的是平台拒绝一个不归它服务的路径，并不是谁收到的响应；运行时应用后记，记的是客户端实际拿到的状态。

- HTTP 请求的日志行改由运行时应用一处写，每个请求一行，状态即客户端拿到的状态。经 API socket 的调用不经过运行时应用，仍由平台记它的一行。
- 新增测试逐类数一个请求留下的行数（静态文件、重新验证的静态文件、SPA 入口、返回错误与成功的 API 路由、socket 调用），要求恰为一行。
