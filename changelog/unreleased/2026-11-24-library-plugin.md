# The plugin domain joins a library package

- **Date:** 2026-11-24
- **Type:** refactor
- **Scope:** `server`, `library/plugin`

[中文版](2026-11-24-library-plugin.zh.md)

The plugin domain moves into a new `@prismshadow/penguin-library-plugin` package: the plugin library and its install, link and uninstall paths, the market and registry readers, the offline archives, the plugin host loader, the plugin DTO contract, and the plugin server-module services. The server imports these; nothing in the library imports the server. The API's export surface stays whole through re-exports — the old import paths keep resolving, and the server package's exported subpaths keep their spelling.

What the domain reads from the server's own facts travels through ports the server binds at its import paths: where a pushed bundle's assets are unpacked, the platform's own interface table, whether the process runs from a development checkout, and the own-table listing the boot-time steps edit a Project's config through. The plugin server-module service keeps its server-side assembly: the Provider binds the service's ports (the config, hot-update, re-assembly, database, channel, log and clock capabilities and the plugin library, ledger, preinstall, project, member and user nodes) to the server's own mechanisms, composing the user-channel lookup over the server's channel hub. The CLI plugin-commands provider keeps its server file for the same reason — its ports are the server's own capabilities — while the contract, the slot and the routes live in the library.

## Details

- `library/plugin` is new. It takes the `plugin/` directory (the loader and host, the library and its install paths, the market, registry and index readers, the offline archives, the config store and its page vocabulary, the tarball, npm and source plumbing, the interface checker, the unsatisfied-plugin report) beside the plugin DTO types moved from the server's API contract, the icon answer the plugin pages name, the plugin mechanisms contract, and the plugin services (archive, library, server modules, server uninstall, tables, uninstall, the one-time preinstall listing).
- The domain reads the server's platform facts through a ports module (`ports`): the unpacked-assets directory, the platform's interface table, the development-profile check, the workbench removal (with its own not-found distinction), and the own-table listing.
- A few DTOs the plugin contract references (the agent-create and task-create shapes) moved along with it because nothing else owns them yet; the server's API contract re-exports every moved name, so its own export surface is unchanged.
- Every interface class involved declares its members under the `@Interface` decorator.
