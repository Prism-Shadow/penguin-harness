# The plugin index's readers become a core export

- **Date:** 2026-11-19
- **Type:** refactor
- **Scope:** `core`, `server`

[中文版](2026-11-19-plugin-index-core.zh.md)

The functions that read a published plugin index — the row check, the release channel a row installs from, SemVer precedence and the newest row per package, and the index's URL — moved out of the server's registry into `@prismshadow/penguin-core/plugin-index`, a subpath with no Node dependency. The server's registry imports them and still exports them under the same names, so its callers did not change; the website's build can now read the index by the same rules without reaching into the server's source.

## Details

- The published index is read from `https://github.com/Prism-Shadow/penguin-harness-plugins/releases/download/nightly/index.json`, the repository's current name, which the documentation already uses. The Plugins settings group's default source names the same address.
