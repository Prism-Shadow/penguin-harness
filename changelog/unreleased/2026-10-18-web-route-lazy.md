# Web App: pages load on demand by route, and the entry chunk drops by half

- **Date:** 2026-10-18
- **Type:** refactor
- **Scope:** `web`

[中文版](2026-10-18-web-route-lazy.zh.md)

Every page the app carries was a static import of the router, so the entry chunk held all twenty
of them — the terminal runtime, the benchmark runner, the model tables — before the login screen
could paint. Each page now sits behind its own dynamic import, and the entry chunk is 1,710,888
bytes where it was 3,238,173.

## Details

| | before | after |
| --- | --- | --- |
| entry chunk (`dist/assets/index-*.js`) | 3,238,173 B | 1,710,888 B (−47.2%) |
| entry chunk, gzip | 988.57 KB | 537.38 KB |
| `/login` first paint | 3,238,173 B | 1,716,589 B |
| `/chat` first paint | 3,238,173 B | 2,676,648 B |
| page chunks | 0 | 20 |
| `dist/assets/*.js` | 121 files, 11.17 MB | 183 files, 11.20 MB |

- `router.tsx` gains a `lazyPage(load, name)` helper that names the export it wants, so the chunk
  Vite emits, a stack frame and a Network panel line all say which page they are instead of an
  anonymous chunk. Twenty modules move behind it: the login page, the terminal, a workbench's app
  page, the seven company pages, and the nine `module.json`-declared pages.
- The chat page and the markdown/KaTeX prose bundle are the two largest of the new chunks (338 KB
  and 497 KB), and `/chat` is the one route whose first paint is still measured in megabytes,
  because it needs both.
- `DRAFT_SESSION_ID` moves to `features/chat/draft-session-id.ts`, and `chat-page.tsx` re-exports
  it so every existing import path still resolves. The sidebar, the app layout, the agents page,
  the plugin page and the AI bridge read it — one string — and a static import is the whole
  module, so the app shell was pulling the chat surface (session stream, stream controller,
  markdown, workspace browser) in to get it.
- No `React.Suspense` boundary is added, at the routes or above them.
