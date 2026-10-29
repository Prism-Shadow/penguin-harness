# 首次连接刚启动的机器不再报「no such account: admin」

- **Date:** 2026-10-29
- **Type:** fix
- **Scope:** `server`, `cli`, `docs`

[English](2026-10-29-machine-first-connect-race.md)

机器上的服务端先绑定端口，再启动平台、创建 `admin` 账号；而连接流程在端口一能连上时就请那台机器的 `penguin auth token` 签发会话。在全新的数据根上，签发可能恰好落在这两步之间，报「no such account: admin」（或没有 `web.db`），配置同步随之显示「Config not synced」，要人重试才行。现在，数据根上有存活的服务端而它尚未创建账号时，`penguin auth token` 会等待，待 admin 创建后再签发。

## 细节

- 只在数据根的服务端锁存活、且数据库不存在或其中一个账号都没有时等待：每 0.25 秒查看一次，20 秒后放弃，失败信息写明服务端尚未完成启动。
- 没有存活的服务端，或已有账号但没有所请求的那个时，命令照旧立即失败，信息与以前相同；等待期间服务端退出，等待随即结束。
- 桌面端自签窗口会话仍然直接签发，不等待。
- CLI 文档中 `penguin auth token` 一节写明了这一等待。
