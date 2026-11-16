# A plugin extends the web app: its pages, removals and file renderers

- **Date:** 2026-10-03
- **Type:** feat
- **Scope:** `web`, `ui`, `server`, `plugins`

[中文版](2026-10-03-web-plugin-contributions.zh.md)

A plugin can shape how the web app is laid out and how files are drawn: it can add a page under another page and frame a document of its own, it can remove a page by naming its key, and it can declare how a kind of Workspace file is rendered below the reply that links it.

## Pages

- Page data gains `parent` (a page key), on the web's `WebAppModule.pages` and the server's `WebModule.pages` alike. The server slot also declares `title`, `titleZh` and `icon`, so a contributed page's nav row is named in both languages and has a glyph. `ContributionsResponse.pages` is typed as `WebPageContribution`.
- The sidebar draws a child as an indented row under its parent, in whichever area the parent is; a child has no pin button and no drag of its own. The collapsed rail draws no row for it and lights the parent while it is open. A page whose parent is absent is neither in the nav nor routed, and pages nest one level only: a page under a page that itself has a parent is dropped.
- `GET /api/plugins/<package>/ui/*` serves the files of a loaded plugin's `ui/` directory, signed-in users only. Any other package answers 404, and so does a path that leaves `ui/`, symlinks included. The workflow `ui/*` route now uses the same content-type table and headers (`http/static-files.ts`).

## Page removals

- The server's `WebModule` gains a `pageRemovals` slot: `{ key }`. `GET /api/contributions` answers it as `pageRemovals`.
- The web app drops the named page from its page table, together with the routes under the page's path (removing `benchmark` takes `/benchmark/:benchmarkId` too) and the pages under it in the nav. A removed page has no row in the sidebar or the collapsed rail, and its URLs fall to the catch-all and lead home (the chat page in development mode, the organizations in company mode). Home and the pages it leads to cannot be removed; `/login` is not in the page table. Removals arrive with the other contributions, so right after a load a removed page can show for a moment before it goes. Safe mode reads no contributions, so it removes nothing.

## File renderers

- The server's `WebModule` gains a `fileRenderers` slot: `{ extensions, renderer }`, extensions without the dot and compared case-insensitively. `GET /api/contributions` answers it as `fileRenderers`.
- In a conversation, when a paragraph or a list item of an assistant reply links a Workspace file whose extension a rule lists, the named renderer is drawn directly below that block: once per file, in link order. The Markdown is unchanged and the link keeps its click (it opens the file in the Files panel). Links inside code are not links. Renderers appear once a reply has settled, not while it streams. Safe mode skips the rules with every other contribution.
- The web app ships one builtin renderer, `audio`: a compact one-row player card on the Workspace file URL (`preload="none"`), drawn from theme tokens with the radius, line and surface of the transcript's other cards — a round accent play/pause button, the file name, elapsed / total time and a thin seek bar whose lighter share marks what has loaded and can be sought. Its width is capped and nothing shifts when the file's length arrives. The button and the seek bar are named after the file, and the bar takes the arrow keys and Home/End. When loading fails, the card becomes a line saying the file cannot be played. Renderers are named in a chat slot, `ChatModule.fileRenderers`; a rule whose renderer is an iframe is skipped.
- The UI package's Markdown renderer gains `ProseBlockTrailerProvider`: a surface may add content after a paragraph or a list item, chosen from the links inside it, on the settled render.
- Workspace files ending in `.mp3`, `.wav`, `.ogg` and `.m4a` are served with their audio content types instead of `application/octet-stream`.
