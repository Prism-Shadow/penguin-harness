# Extensions are called plugins

- **Date:** 2026-08-31
- **Type:** refactor
- **Scope:** `core`, `server`, `plugins`, `docs`
- **PR:** [#354](https://github.com/Prism-Shadow/penguin-harness/pull/354)
- **Breaking:** yes — `extensions.json` is read no longer; the config file is `plugins.json`, and both SDK subpaths moved from `/extension` to `/plugin`

[中文版](2026-08-31-plugin-rename.zh.md)

The mechanism that lets a deployment install capability the harness does not ship is called the **plugin** mechanism. One word covers the config file, the two SDK subpaths, the contract's type names, the backend package names and the directory they live in, so a reader meets the same term wherever the concept appears.

## Details

- **The config file is `<root>/plugins.json`**, and its one key is `plugins`. Same shape otherwise: a list of package specifiers, resolved against the installation, absent means no plugins.
- **The SDK subpaths are `@prismshadow/penguin-core/plugin` and `@prismshadow/penguin-server/plugin`.** Both still emit types only.
- **The contract's names carry the word:** `Extension` → `Plugin`, `ExtensionContext` → `PluginContext`, `ExtensionEvents` → `PluginEvents`, and on the harness side `ExtensionHost` → `PluginHost`. `PenguinContext`, `PenguinInterface`, `HarnessContext` and the whole sandbox vocabulary are unchanged.
- **The four sandbox backends are `@prismshadow/penguin-plugin-sandbox-{dsh,bwrap,seatbelt,mxc}`** and live under `packages/plugins/`, one directory holding all of them. They are still no part of what this repository builds and ships: nothing else under `packages/` depends on one, the platform bundle carries none, and the workspace glob names them separately.
- **`plugin` is not cordis's `plugin`.** The DSH adaptor mounts DSH's chain through cordis's own `Context.plugin`; the two vocabularies share nothing but the word, and the adaptor names its cordis context accordingly.

## Compatibility

An `extensions.json` already on disk is **not read** and not migrated. A deployment that configured plugins under the old name keeps running, with none of them loaded and their capability silently unavailable — for the sandbox backends that means commands spawn unconfined. Rename the file to `plugins.json` and its `"extensions"` key to `"plugins"`; the specifiers inside change only if they name this repository's sandbox backends, whose packages are now `@prismshadow/penguin-plugin-sandbox-*`.

A package compiled against `@prismshadow/penguin-core/extension` or `@prismshadow/penguin-server/extension` no longer resolves. Point the import at `/plugin` and rename the three types it uses.

Nothing about the wire format, the database or any other on-disk document changes.
