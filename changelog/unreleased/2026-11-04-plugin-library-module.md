# The plugin library is a node of the server's module tree, and the sandbox backends carry a card

- **Date:** 2026-11-04
- **Type:** refactor
- **Scope:** `server`, `plugins`
- **PR:** [#1478](https://github.com/Prism-Shadow/penguin-harness/pull/1478)

[中文版](2026-11-04-plugin-library-module.zh.md)

The server gained `PluginLibraryModule`, a child of the platform root that declares the five data-only slots a plugin declares its content to — `cards`, `skills`, `hooks`, `mcpServers`, `workbenches` — and provides `PluginLibrary` (penguin-harness-design [#421](https://github.com/Prism-Shadow/penguin-harness-design/pull/421)). The plugin routes, the Agent service and Agent seeding read the library through it instead of calling core's reader directly.

## Details

- `PluginLibrary` lists the library, groups it by category, looks a plugin up by name, answers the preinstalled set, a plugin's README and where its package is. It reads the packages on disk through core's reader on every call and boots no content plugin; when a booted module contributes Skills, a hook package, MCP servers or workbenches under a plugin name that read does not list, the server logs it once.
- `PluginLibrary` and `PluginLibrarySlots` are exported as types from `@prismshadow/penguin-server/plugin`.
- The four sandbox backends contribute a card beside their sandbox provider: their title, descriptions, category, icon and `preinstall: false`. The server's embedded index rows of them are checked against those cards, each generated from the backend's source by the generator its build runs.
- The plugin loader reads a package's table and its code entry with core's reader (`readPluginTable`, `packageEntry`) instead of its own copy.
