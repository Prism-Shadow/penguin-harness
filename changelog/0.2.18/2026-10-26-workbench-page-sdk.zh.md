# Workbench 页面从自己的服务端加载 AMSP 页面 SDK

- **Date:** 2026-10-26
- **Type:** feature
- **Scope:** `server`, `amsp`
- **PR:** [#1347](https://github.com/Prism-Shadow/penguin-harness/pull/1347)

[English](2026-10-26-workbench-page-sdk.md)

服务端开始在每个 Workbench 旁提供页面 SDK。Workbench 页面可以借登录身份下的 Session 流实时跟随 Agent 的对话，也可以停止正在运行的 Task。

## 细节

- `GET /api/projects/:projectId/agents/:agentId/workbenches/:id/sdk/amsp.js` 原样提供 `@prismshadow/amsp` 的浏览器构建；`…/sdk/workbench.js` 将其整体再导出，并新增 `apiBase`、`transport`、`followSession(id, { tailLimit? })` 与 `abortSession(id)`。页面引入 `../sdk/workbench.js` 即可，同一个相对路径对机器上的 Workbench（`/server/<machineId>/api/…`）和 `pnpm dev` 同样有效。
- 两个文件均以 `text/javascript` 返回，带 `cache-control: no-cache` 与 ETag，只对该 Project 的成员开放；Project 或 Workbench 不存在时返回 404。
- `@prismshadow/amsp` 新增导出 `@prismshadow/amsp/browser-source`，以字符串 `BROWSER_SOURCE` 提供浏览器构建。服务端通过导入取得它，因此桌面端和热推送构建这类不带 `node_modules`、整体打包运行的服务端同样带有这份 SDK。
