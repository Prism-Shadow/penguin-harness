# 插件可以从 Web 中移除页面

- **Date:** 2026-10-03
- **Type:** feat
- **Scope:** `web`, `server`, `plugins`

[English](2026-10-03-web-page-removal.md)

插件可以按 key 移除 Web 中的页面，无论是应用自带的页面还是其他插件贡献的页面。

- 服务器的 `WebModule` 新增 `pageRemovals` 槽位：`{ key }`。`GET /api/contributions` 以 `pageRemovals` 返回。
- Web 从页面表中去掉所指名的页面，连同路径落在其路径之下的路由（移除 `benchmark` 也带走 `/benchmark/:benchmarkId`）与导航中挂在它下面的页面。被移除的页面在侧栏和收起后的 rail 中都没有行，其 URL 落到兜底路由、回到首页（开发模式下为 chat 页面，公司模式下为组织页）。首页及其去处的页面不可移除；`/login` 不在页面表中。移除随其他贡献一起到达，因此刚加载时被移除的页面可能短暂出现后才消失。安全模式不读取贡献，因此不移除任何页面。
- `plugins/example-no-evaluation-center`：移除 Evaluation Center 的示例插件。README 说明如何启用，以及如何找回该页（停用插件，或以安全模式打开应用）。private 包，不发布；作为 `plugins/example-*` 目录也不随构建内置，除非以 `PENGUIN_PLUGIN_EXAMPLES=1` 暂存示例插件，之后由 Project 按包名启用。
- Web e2e 的运行脚本按插件集合各起一个服务端：默认集合照旧，另起一个启用移除插件的服务端只跑它自己的 spec，其余 spec 不受影响。`E2E_PLUGIN_SET` 可只跑其中一个集合。
