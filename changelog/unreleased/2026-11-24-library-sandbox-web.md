# The sandbox domain's web half moves into the library package

- **Date:** 2026-11-24
- **Type:** refactor
- **Scope:** `library/sandbox`, `packages/web`

[中文版](2026-11-24-library-sandbox-web.zh.md)

The sandbox domain's web half — the admin settings card that edits the per-user ceilings on open terminals and browsers (`ResourceLimitsSection`, the card behind the settings dialog's resource-limits page) — moves from the web app's settings feature into `@prismshadow/penguin-library-sandbox`'s own `./web` face (`library/sandbox/src/web/`). The card is the admin side of the capability whose service, policy reads and status reads the library already holds server-side; the ceilings it edits are the ones the sandbox service enforces. The web app compiles the face in with its own program: the library's build and typecheck stay server-side, and the face is TypeScript source the host's Vite and tsconfig read directly.

The host and the moved card meet on the same two seams as the workspace, machines and terminal halves before them: the app's internals the card consumes are re-exported from `@prismshadow/penguin-web/internal` (the admin settings endpoints, the unsaved-changes scope, the strings runtime and the API error toast), and the card's consumer — the settings dialog — imports the face directly (`@prismshadow/penguin-library-sandbox/web`). No import path of the moved code is public outside the app.

## Details

- `library/sandbox` gains `src/web/` with the moved section and a face entry; its `exports` grow `./web` and `./web/*`; its `dependencies` gain `@prismshadow/penguin-library-setting` (the limit defaults the card seeds its form with), and the web half's bare dependencies (react, the UI package, the web face the internal seam resolves through) sit in `devDependencies`, resolved by the compiling host.
- `packages/web` maps the sandbox face in its tsconfig and lists the library package as a dev dependency; `src/internal.ts` grows the admin settings endpoints and the unsaved-changes scope the card reads.
- The settings feature's source drops the moved card and reads it through the face; the section's unit test imports the face the same way.
