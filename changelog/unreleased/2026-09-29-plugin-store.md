# A content-addressed plugin store under the data root

- **Date:** 2026-09-29
- **Type:** feature
- **Scope:** `server`
- **PR:** [Myriad-Dreamin/penguin-harness#PR_NUMBER](https://github.com/Myriad-Dreamin/penguin-harness/pull/PR_NUMBER)

[中文版](2026-09-29-plugin-store.zh.md)

Every server plugin a machine receives is now also kept in `<data root>/plugin-store/`. The store has the same shape as the `plugins/` tree of the penguin-plugins index repository. Nothing loads from it yet: which plugins a process runs, and where they are resolved from, is unchanged.

## Layout

- One entry per `<npm name>/<version>/<first 16 hex digits of integrity>/`, holding `manifest.toml` (the index manifest, `integrity` included), `package-lock.json`, `package/` (the unpacked package with its dependencies inside its own `node_modules`) and `.stored` (when, from which source).
- `.stored` is written last. An entry without it does not exist, and the next write of the same content replaces it.
- `integrity` is `sha256-<hex>` over `package/`, packed by the hot push's deterministic archiver, before gzip. One content is stored once. Two versions of a name, or two contents of one version, are two entries.
- `plugin-store/index.json` is rebuilt from the tree after every write. It is a flat array in the index's shape, each row with its `integrity`.

## Sources

- **Hot push:** each builtin plugin a push carried goes into the store at the next boot. The push's own prefix manifest stays with the push and is not an entry.
- **Build:** the plugins the installation ships beside the program are checked by hash at every boot and copied when missing. This runs in the background and is logged, never failing the boot.
- **Registry:** installing a plugin from the Plugins page first fetches it with npm into `plugin-store/.staging/<pid>/`, packs and hashes it, and stores it before the existing install runs. A package whose hash differs from the one its index entry names is refused with `400 plugin_store_failed`. Index entries do not carry `integrity` yet.
