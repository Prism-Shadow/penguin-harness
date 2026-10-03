# Pages the server contributes reach the web app

- **Date:** 2026-10-03
- **Type:** feat
- **Scope:** `web`

[中文版](2026-10-03-web-server-contributed-pages.zh.md)

The web app reads `GET /api/contributions` and folds the pages the server's modules and plugins contribute to `WebModule.pages` into WebApp's page table, after the compiled pages. The router and the sidebar read them like any other page.

- One place owns it: `web-app/contributions.tsx` fetches once per signed-in user, asks again when the user changes, and keeps the compiled table alone when the request fails. While the request is in flight, the router does not redirect an unknown path, so a contributed page opened by its URL stays on it.
- An `iframe` renderer is drawn by WebApp's frame page (`web-app/frame-page.tsx`), framed like a workflow's tab: same sandbox (now `PAGE_FRAME_SANDBOX` in `lib/workflow-theme.ts`, shared with the workflow frame), the app's appearance copied in, keys forwarded. A `builtin` renderer is skipped: this build carries no builtin page renderer.
- A compiled page wins over a contributed page with the same key or path.
- The nav links a page by its `path` instead of `/<key>`; the compiled pages are unchanged.
- `PageEntry` and `mergePages` in `web-app/page-table.ts`, which nothing called, are gone.
