# Pages the server contributes reach the web app

- **Date:** 2026-10-03
- **Type:** feat
- **Scope:** `web`

[中文版](2026-10-03-web-server-contributed-pages.zh.md)

The web app reads `GET /api/contributions` and folds the pages the server's modules and plugins contribute to `WebModule.pages` into WebApp's page table, after the compiled pages. The router and the sidebar read them like any other page.

- One place owns it: `web-app/contributions.tsx` fetches once per signed-in user, asks again when the user changes, and keeps the compiled table alone when the request fails. While the request is in flight, the router does not redirect an unknown path, so a contributed page opened by its URL stays on it.
- An `iframe` renderer is drawn by WebApp's frame page (`web-app/frame-page.tsx`), framed like a workflow's tab: same sandbox (now `PAGE_FRAME_SANDBOX` in `lib/workflow-theme.ts`, shared with the workflow frame), the app's appearance copied in, keys forwarded. A `builtin` renderer names a component a module contributes to the new slot `WebAppModule.pageRenderers` (name → component); a name nobody contributed is skipped. The proposals page is the one such renderer: `features/proposals/module.ts` contributes `OrgProposalsPage`.
- A compiled page wins over a contributed page with the same key or path.
- The nav links a page by its `path` instead of `/<key>`; the compiled pages are unchanged.
- `PageEntry` and `mergePages` in `web-app/page-table.ts`, which nothing called, are gone.
- It is the only reader of `/api/contributions`: `state/contributions.tsx` (`ContributionsProvider`) and the separate request in company mode's `use-org-pages.ts` are deleted, as are `web-app/contributed-page.tsx` and `contributedPages`/`orgPagesOf` in `web-app/page-table.ts`. The same reader hands the session surfaces and the module plugins' quick starts, with a `refresh`, to the chat page and the Plugins page (`useContributions()` from the WebApp); `surfaceLabel` moved to the chat page's `session-surface-view.tsx`.
- Company-mode pages (`nav: "org"`) are in WebApp's page table too, with paths relative to an organization and the renderer each named; `useOrgPages()` is a selector over that table. Such a page is mounted under the organization layout and also from the root (`/proposals` opens the proposals page again); an iframe one, such as the roadmaps page, is now drawn by WebApp's frame page. Neither the router nor company mode imports the proposals page.
- A contributed company-mode page's nav row is keyed by its renderer's name, and one renderer draws one row; company's unread count anchors on `OrgProposalsPage` instead of the plugin's page key `org-proposals`.
