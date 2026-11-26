# 服务端启动或 swap 期间到达的 socket 不再导致进程退出

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `server`

[English](2026-11-26-boot-race-no-crash.md)

浏览器中仍开着上一个服务端的标签页，在新数据根尚在启动时重连 API socket，服务端进程随即以 `no api 'Auth' on module 'IdentityModule'` 退出。原因是：admin 种子会建立 `default_project`，其预装模块触发 App 重组；WebSocket 握手读取 Auth 节点时，所在的树已被这次重组 dispose。这一异常从 `upgrade` 监听器中抛出，没有任何地方捕获。另外，只要一个目标不是 URL 的升级请求（`GET http://[ HTTP/1.1`），运行中的服务端也会以同样方式退出。

## 细节

- 启动（含 admin 种子）完成之前，服务端对所有路径都答「starting」：请求得到带 `retry-after` 的 503，WebSocket 握手完成后立即以 1013（Try Again Later）关闭。App 的路由与升级监听器在种子之后才挂上。
- 推送或重组使运行中的树处于已 dispose 状态时，入口使用最近一次解析到的 Auth 节点来认证握手、复核已打开 API socket 的登录。HTTP 面原本就是这样处理的。
- 终端流或 API socket 的握手失败会记入日志，并以 500 拒绝；目标不是 URL 的请求以 400 拒绝；登录复核抛错的 API socket 以 1011 关闭。这些情况都不再导致进程退出。
