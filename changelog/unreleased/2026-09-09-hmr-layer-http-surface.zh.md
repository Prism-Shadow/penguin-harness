# HMR 层的 HTTP 面只剩 /api/hmr

- **Date:** 2026-09-09
- **Type:** improvement
- **Scope:** `server`
- **PR:** [#656](https://github.com/Myriad-Dreamin/penguin-harness/pull/656)

[English](2026-09-09-hmr-layer-http-surface.md)

`/api/auth`（登录、登出、一次性 claim 链接）与 `/api/desktop`（shell 的停机和客户端更新中继）此前由 HMR 层挂在平台 HTTP 接缝之上，任何改动都只能靠重装每个安装发布。现在它们是平台的路由组（`AuthRoutes`、`DesktopRoutes`、`DesktopUpdateRoutes`），与其他路由一样经接缝提供；HMR 层在接缝之上只挂 `/api/hmr`。

平台的路由表不再携带一份要拒绝的前缀清单：`/api/auth` 下的未知路径由该组自己答 404，而不是被 cookie 门拦成 401。

HMR 层在接缝之下保留这两组路由的回滚副本，见[向后兼容](2026-09-09-backward-compatibility.zh.md)。
