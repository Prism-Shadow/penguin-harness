# Plugins are npm tarballs checked against npm's integrity, loaded where they arrive, and reach every channel

- **Date:** 2026-09-29
- **Type:** feature
- **Scope:** `server`, `core`, `cli`, `docker`, `release`
- **PR:** [#945](https://github.com/Prism-Shadow/penguin-harness/pull/945)
- **Breaking:** yes

[中文版](2026-09-29-plugin-distribution.zh.md)

A plugin packs itself: its npm tarball is all of it, and what it declares as dependencies is not installed. A plugin is identified by name, version and npm's own `dist.integrity`. It stays where it arrived, unpacked under a prefix's `node_modules/<name>/` with that integrity beside it as `.integrity`: the build's bundled plugin directory, or `<data root>/plugins/` for a download. Every build carries its plugins the same way, the Docker image and a source checkout included. A shipped plugin still loads only when a Project asks for it.

## Builds and the index

- `builtin-index.json` is gone. `build-plugins` packs each plugin once with `pnpm pack`, records the tarball's integrity, and unpacks it into the build's bundled plugin directory, `plugins/{index.json, node_modules/<name>/}`. The release publishes those very tarballs (`--tarballs`).
- `GET /api/plugins/registry` merges the published index, the build's index and the downloaded plugins, in that order, with one row per content (name, version, integrity). A yanked row is left out.

## Loading and download

- Before every App boot, each name the Projects ask for resolves among the packages on the machine: a pin takes that content only; otherwise the highest satisfying version wins, and within one version the build's own copy wins.
- Installing a plugin the machine lacks downloads the index entry's exact version with `npm pack`. This uses the npm on `PATH`, then the running Node's directory, and on Windows runs `npm.cmd` through cmd.exe. The tarball's sha512 is checked against the entry's integrity, and a mismatch returns `400 plugin_integrity_mismatch`. A matching tarball is unpacked under `<data root>/plugins/.staging/`, then renamed into `node_modules/<name>/`. Only after that is the version it replaces deleted.
- A crash between those renames is recovered at the next boot without the network: the package left aside goes back.
- A plugin that the running build lacks but a push hmr still retains has its package copied into `<data root>/plugins/` before that push is pruned.
- `POST …/plugins/installed` accepts `integrity` and writes a pin. Removing a plugin only edits the table.

## Channels

- **Docker image:** carries the bundled plugin directory at `/opt/penguin/lib/plugins`, found beside the entry's real path. The Docker quickstart gains a section on sandboxing inside a container.
- **npm global install:** `@prismshadow/penguin-cli` carries `plugins/index.json` alone. Enabling a listed plugin downloads it from the registry.
- **Source checkout:** `pnpm build` and the dev prestep write the bundled plugin directory to `packages/cli/plugins/` and `packages/server/plugins/`. A Project's plugin table no longer loads an absolute path.
- `@penguinharness/sandbox-dsh` declares runtime dependencies and does not load until it packs them itself.

## Compatibility

- A Project table entry that names a plugin by absolute path no longer loads. The Plugins page shows why, and the plugin should come from a dev build's bundled plugin directory instead.
- Packages an earlier build installed with `npm install` into `<data root>/plugins/node_modules/` still load by version. They record no integrity, so a pin cannot select them. The dependencies npm put beside them stay where they are and are no longer maintained.
