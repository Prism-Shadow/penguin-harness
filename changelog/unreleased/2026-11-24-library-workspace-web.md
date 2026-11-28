# The workspace domain's web half moves into the library package

- **Date:** 2026-11-24
- **Type:** refactor
- **Scope:** `library/workspace`, `packages/web`

[中文版](2026-11-24-library-workspace-web.zh.md)

The Workspace domain's web half — the Files panel's browser, the read-only directory browser, the Workspace picker every create form opens, the reply-link provider, and the page workspace's layout area — moves from the web app into `@prismshadow/penguin-library-workspace`'s own `./web` face (`library/workspace/src/web/`). The web app compiles the face in with its own program: the library's build and typecheck stay server-side, and the face is TypeScript source the host's Vite and tsconfig read directly.

The host and the moved half meet on two new seams. The app's internals the half consumes are re-exported from one hub, `@prismshadow/penguin-web/internal`; references to the dock and to the features that have not moved yet go through the same hub until their own faces land. Every other consumer imports the face directly (`@prismshadow/penguin-library-workspace/web`, `/web/page-workspace`, and `/web/*` for single modules); no import path of the moved code is public outside the app.

The guard scans over the app's source learn the new roots (`library/<domain>/src/web/`), so the rules keep judging the moved files where they now live.

## Details

- `library/workspace` gains `src/web/` (the workspace feature's eleven files) and `src/web/page-workspace/` (five files); its `exports` grow `./web` and `./web/*`; the package's `dependencies` stay server-side — the web half's bare dependencies sit in `devDependencies`, resolved by the compiling host.
- `packages/web` re-exports its internals through the new `src/internal.ts` (exposed as `./internal`), maps the workspace face in its tsconfig, and lists the library package as a dev dependency.
- The web app's own source drops the two feature directories; the workspace module joins the app's boot through the face import.
