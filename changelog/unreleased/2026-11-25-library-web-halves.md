# The workbench and organization domains' web pages join their library packages

- **Date:** 2026-11-25
- **Type:** refactor
- **Scope:** `web`, `library/workbench`, `library/organization`, `ui-gallery`

[中文版](2026-11-25-library-web-halves.zh.md)

The workbench, app center, company and admin pages move out of the Web App into the library packages that own their domains: `@prismshadow/penguin-library-workbench` takes the workbench and app-center pages, `@prismshadow/penguin-library-organization` takes the company and admin pages. Each package serves its pages through a new `./web` export, and the Web App renders them exactly as before.

## Details

- The `./web` export points at the TypeScript sources of the pages. Each package's face index exports its module classes by name, and the web-root bootstraps them the same way it did when the pages lived in the Web App.
- The Web App lists no dependency on the library packages. The faces resolve through path aliases shared by tsconfig, vite and vitest, so builds and tests consume the workspace sources directly.
- Pages that moved read the Web App's state, api, components and rescue through `@prismshadow/penguin-web/internal`. Pages that stay behind import each other through `@prismshadow/penguin-web/features/<name>`. The boundary tests that forbid a library package from importing a Web App feature keep holding.
- The library web halves declare no dependency on the server package: their api types are type-only, and the one runtime value they need — the ticket slug pattern — is re-exported through the internal hub.
- The ui gallery boots the same web-root, so it resolves the faces through the same aliases.
