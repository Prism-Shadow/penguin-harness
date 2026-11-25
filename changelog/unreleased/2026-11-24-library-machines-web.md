# The machines domain's web half moves into the library package

- **Date:** 2026-11-24
- **Type:** refactor
- **Scope:** `library/machine`, `packages/web`

[中文版](2026-11-24-library-machines-web.zh.md)

The machines domain's web half — the Machines page and its cards, detail and add-machine dialogs, the ssh host dialog, the machines' derived view state, the machine picker other forms open, and the module that boots them — moves from the web app into `@prismshadow/penguin-library-machine`'s own `./web` face (`library/machine/src/web/`). The web app compiles the face in with its own program: the library's build and typecheck stay server-side, and the face is TypeScript source the host's Vite and tsconfig read directly.

The host and the moved half meet on the same two seams as the workspace half before it: the app's internals the half consumes are re-exported from `@prismshadow/penguin-web/internal`, and every other consumer imports the face directly (`@prismshadow/penguin-library-machine/web`, `/web/<module>` for single files). No import path of the moved code is public outside the app.

## Details

- `library/machine` gains `src/web/` (the machines feature's fourteen files); its `exports` grow `./web` and `./web/*`; the package's `dependencies` stay server-side — the web half's bare dependencies sit in `devDependencies`, resolved by the compiling host.
- `packages/web` maps the machine face in its tsconfig and lists the library package as a dev dependency; `src/internal.ts` grows the shared pieces the half reads (`lib/card-open`, `lib/notice-dismissals`, `lib/use-document-title`, the `lib/format` and `lib/failure` readers, and the `Tone` type).
- The web app's own source drops the machines feature directory; the machines module joins the app's boot through the face import.
