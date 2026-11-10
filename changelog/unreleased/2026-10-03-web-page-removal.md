# A plugin can remove a page from the web app

- **Date:** 2026-10-03
- **Type:** feat
- **Scope:** `web`, `server`, `plugins`

[中文版](2026-10-03-web-page-removal.zh.md)

A plugin can take a page away from the web app — one of the app's own or one another plugin contributed — by naming its key.

- The server's `WebModule` gains a `pageRemovals` slot: `{ key }`. `GET /api/contributions` answers it as `pageRemovals`.
- The web app drops the named page from its page table, together with the routes under the page's path (removing `benchmark` takes `/benchmark/:benchmarkId` too) and the pages under it in the nav. A removed page has no row in the sidebar or the collapsed rail, and its URLs fall to the catch-all and lead home (the chat page in development mode, the organizations in company mode). Home and the pages it leads to cannot be removed; `/login` is not in the page table. Removals arrive with the other contributions, so right after a load a removed page can show for a moment before it goes. Safe mode reads no contributions, so it removes nothing.
