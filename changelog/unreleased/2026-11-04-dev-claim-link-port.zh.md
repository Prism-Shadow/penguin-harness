# `pnpm dev` 下的首次登录链接能直接打开 App

- **Date:** 2026-11-04
- **Type:** fix
- **Scope:** `server`, `tooling`
- **PR:** [#1454](https://github.com/Prism-Shadow/penguin-harness/pull/1454)

[English](2026-11-04-dev-claim-link-port.md)

在 `pnpm dev` 下，服务器打印的首次登录链接指向后端的 7368 端口，而 7368 不提供 App 页面，打开后只看到「not found」报错，得手动把端口改成 7365。现在 `pnpm dev` 会通过 `PENGUIN_DEV_APP_PORT=7365` 把 App 的端口告诉后端，链接直接指向 7365。

## 细节

- `PENGUIN_DEV_APP_PORT` 只影响首次登录链接；工作区预览和交给 Agent 的 API 地址仍使用后端自己的端口。
- 没有设置这个变量时（单独运行 `pnpm dev:server`、安装版、桌面版），链接与原来一样。值无效时服务器在启动时报错，而不是悄悄忽略。
