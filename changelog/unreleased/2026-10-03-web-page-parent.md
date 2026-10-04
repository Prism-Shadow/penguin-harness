# A plugin page under another page, served from the plugin's own files

- **Date:** 2026-10-03
- **Type:** feat
- **Scope:** `web`, `server`, `plugins`

[中文版](2026-10-03-web-page-parent.zh.md)

A page can sit under another page, and a plugin can ship the document its page frames.

- Page data gains `parent` (a page key), on the web's `WebAppModule.pages` and the server's `WebModule.pages` alike. The server slot also declares `title`, `titleZh` and `icon`, so a contributed page's nav row is named in both languages and has a glyph. `ContributionsResponse.pages` is typed as `WebPageContribution`.
- The sidebar draws a child as an indented row under its parent, in whichever area the parent is; a child has no pin button and no drag of its own. The collapsed rail draws no row for it and lights the parent while it is open. A page whose parent is absent is neither in the nav nor routed, and pages nest one level only: a page under a page that itself has a parent is dropped.
- `GET /api/plugins/<package>/ui/*` serves the files of a loaded plugin's `ui/` directory, signed-in users only. Any other package answers 404, and so does a path that leaves `ui/`, symlinks included. The workflow `ui/*` route now uses the same content-type table and headers (`http/static-files.ts`).
- `plugins/example-hello-page`: an example plugin that adds a "Hello World" page under the Evaluation Center. Its page has a button that shows "Hello World". It is private, so it is not published, and `scripts/build-plugins.mjs` now skips the `plugins/example-*` directories, so it is not shipped either. The web e2e suite enables it for its run.
