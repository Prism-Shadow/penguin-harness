# Plugins: broken links keep their link mark and origin path, and `penguin plugin link` handles multi-link and library-only packages

- **Date:** 2026-11-17
- **Type:** fix
- **Scope:** `server`, `cli`
- **PR:** [#1600](https://github.com/Prism-Shadow/penguin-harness/pull/1600)

[中文版](2026-11-17-fix-plugin-link-metadata.zh.md)

The installed-plugins listing dropped `linked` and `linkPath` once a linked author directory could no longer be read on disk, and `penguin plugin link` picked the first linked entry instead of the newly linked plugin and rejected library-only packages before contacting the server.

## Details

- The installed-plugins listing in `installedPluginRoutes` (`packages/server/src/http/routes/plugins-installed.ts`) now preserves `linked: true` and `linkPath` on the error row returned when `readPluginDeclaration` fails for a linked package.
- `penguin plugin link` now matches `res.plugins` against `res.installed?.name` when reading `linkPath`, so linking a second local plugin prints its own path rather than the first linked plugin's path.
- `penguin plugin link` now shares the package-directory check used by directory installs, accepting Skills, hook, MCP server, and workbench packages just like `POST /api/projects/:projectId/plugins/installed/link`.
