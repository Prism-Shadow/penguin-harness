# 服务端贡献的页面进入 Web 应用

- **Date:** 2026-10-03
- **Type:** feat
- **Scope:** `web`

[English](2026-10-03-web-server-contributed-pages.md)

Web 读取 `GET /api/contributions`，把服务端模块与插件向 `WebModule.pages` 贡献的页面并入 WebApp 的页面表，排在编译期页面之后。router 与侧边栏像读其他页面一样读取它们。

- 收在一处：`web-app/contributions.tsx` 每个登录用户取一次，用户切换时重取，请求失败时只保留编译期页面表。请求进行中时 router 不重定向未知路径，因此直接打开贡献页面的 URL 会停在该页。
- `iframe` renderer 由 WebApp 的 iframe 页（`web-app/frame-page.tsx`）绘制，框法与 workflow 标签相同：同一 sandbox（提为 `lib/workflow-theme.ts` 的 `PAGE_FRAME_SANDBOX`，workflow 框共用）、拷入应用外观、转发按键。`builtin` renderer 指名某个模块向新 slot `WebAppModule.pageRenderers`（名字 → 组件）贡献的组件，无人贡献的名字跳过。提案页是唯一这样的 renderer：`features/proposals/module.ts` 贡献 `OrgProposalsPage`。
- 与编译期页面同 key 或 path 时，编译期页面胜出。
- 导航按页面的 `path` 而非 `/<key>` 生成链接；编译期页面不受影响。
- `web-app/page-table.ts` 中无人调用的 `PageEntry` 与 `mergePages` 删除。
- 它是 `/api/contributions` 唯一的读取方：`state/contributions.tsx`（`ContributionsProvider`）与公司模式 `use-org-pages.ts` 中单独的请求删除，`web-app/contributed-page.tsx` 及 `web-app/page-table.ts` 的 `contributedPages`/`orgPagesOf` 一并删除。同一读取方把 session surface 与模块插件的 quick start（带 `refresh`）交给聊天页与插件页（WebApp 的 `useContributions()`）；`surfaceLabel` 移到聊天页的 `session-surface-view.tsx`。
- 公司模式页面（`nav: "org"`）也进入 WebApp 的页面表，路径相对于组织并保留各自声明的 renderer；`useOrgPages()` 是该表上的 selector。这类页面挂在组织布局下，也从根路径挂载（`/proposals` 重新打开提案页）；iframe 类的（如路线图页）现由 WebApp 的 iframe 页绘制。router 与公司模式都不再直接导入提案页。
- 贡献的公司模式页面的导航行按 renderer 名字作 key，一个 renderer 只画一行；公司的未读计数锚定在 `OrgProposalsPage` 上，而不是插件的页面 key `org-proposals`。
