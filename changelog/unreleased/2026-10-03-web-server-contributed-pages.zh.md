# 服务端贡献的页面进入 Web 应用

- **Date:** 2026-10-03
- **Type:** feat
- **Scope:** `web`

[English](2026-10-03-web-server-contributed-pages.md)

Web 读取 `GET /api/contributions`，把服务端模块与插件向 `WebModule.pages` 贡献的页面并入 WebApp 的页面表，排在编译期页面之后。router 与侧边栏像读其他页面一样读取它们。

- 收在一处：`web-app/contributions.tsx` 每个登录用户取一次，用户切换时重取，请求失败时只保留编译期页面表。请求进行中时 router 不重定向未知路径，因此直接打开贡献页面的 URL 会停在该页。
- `iframe` renderer 由 WebApp 的 iframe 页（`web-app/frame-page.tsx`）绘制，框法与 workflow 标签相同：同一 sandbox（提为 `lib/workflow-theme.ts` 的 `PAGE_FRAME_SANDBOX`，workflow 框共用）、拷入应用外观、转发按键。`builtin` renderer 一律跳过：本构建不带任何 builtin 页面 renderer。
- 与编译期页面同 key 或 path 时，编译期页面胜出。
- 导航按页面的 `path` 而非 `/<key>` 生成链接；编译期页面不受影响。
- `web-app/page-table.ts` 中无人调用的 `PageEntry` 与 `mergePages` 删除。
