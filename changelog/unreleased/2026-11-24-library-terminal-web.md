# The terminal domain's web half moves into the library package

- **Date:** 2026-11-24
- **Type:** refactor
- **Scope:** `library/terminal`, `packages/web`

[中文版](2026-11-24-library-terminal-web.zh.md)

The terminal domain's web half — the standalone `/terminal` page, the pooled xterm view and its runtime, the dock's terminal panel, the connection/frames/stream/links/touch/keys pieces under them, and the module that boots the page — moves from the web app into `@prismshadow/penguin-library-terminal`'s own `./web` face (`library/terminal/src/web/`). The web app compiles the face in with its own program: the library's build and typecheck stay server-side, and the face is TypeScript source the host's Vite and tsconfig read directly.

The host and the moved half meet on the same two seams as the workspace and machines halves before them: the app's internals the half consumes are re-exported from `@prismshadow/penguin-web/internal` (the dock store, the dock's terminal helpers and panel registry included — the dock stays host-side for now), and every other consumer imports the face directly (`@prismshadow/penguin-library-terminal/web`). The dock's `dock-terminal.ts` reads the terminal list through the face, so the terminal↔dock import cycle ends with the move. No import path of the moved code is public outside the app.

## Details

- `library/terminal` gains `src/web/` (the terminal feature's eighteen files plus five unit tests); its `exports` grow `./web` and `./web/*`; the package's `dependencies` stay server-side — the web half's bare dependencies (react, the xterm packages, the UI and web-plugin packages) sit in `devDependencies`, resolved by the compiling host. The unit tests run from the web app's Vitest config, which now includes the face's test directory.
- `packages/web` maps the terminal face in its tsconfig and lists the library package as a dev dependency; `src/internal.ts` grows the shared pieces the half reads (theme, coarse-pointer and viewport hooks, the shortcut label and terminal key/clipboard actions, the terminal-machine resolvers, the session probe and API url, and the terminal http helpers).
- The web app's own source drops the terminal feature directory; the terminal module joins the app's boot through the face import, and the app's module-manifest guard drops the in-app terminal entry.
