# 服务端域代码下沉为 library 包

- **Date:** 2026-11-18
- **Type:** refactor
- **Scope:** `server`, `core`, `web`, `cli`, `desktop`
- **PR:** [#1574](https://github.com/Prism-Shadow/penguin-harness/pull/1574)

[English](2026-11-18-library-domain-packages.md)

服务端的域代码从 server 包迁出到 `library/` 下的十三个库包：每个域一包（`db`、`setting`、`machine`、`messaging`、`organization`、`trace`、`observability`、`auth`、`project`、`session`、`agent-api`、`model`、`workbench`），各承载该域的契约与其 repo，依赖单向——library 包不引用 server。server 继续装配它们并作为普通 workspace 包消费：这些包是私有的、随 server 构建打包，不发布新包。

## 兼容性

公开的 HTTP/SSE API 不变，面向客户端的类型入口（`@prismshadow/penguin-server/api` 与 server 其余子路径）继续导出同名类型；迁出的形状在原位置 re-export。跨过这次改动的一次 hot-push 升级会重建运行中的 Agent 状态，而不是接管前代的状态——状态契约的接口身份随迁移而变：该次升级会中断推送时正在运行的会话（重新打开同一页面即可恢复），之后的推送照旧接管状态。
