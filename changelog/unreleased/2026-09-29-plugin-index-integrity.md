# Every plugin index entry names its content

- **Date:** 2026-09-29
- **Type:** feature
- **Scope:** `server`, `core`, `web`, `tooling`

[中文版](2026-09-29-plugin-index-integrity.zh.md)

A plugin index entry now carries `integrity`, the same key the plugin store files a package under, and the three sources of the plugin catalogue share one shape. A download is checked against its entry before it is stored, and a Project can pin the exact content it runs.

## Integrity

- `integrity` is `sha256-` and 64 hex digits over the package's deterministic archive. The archiver is `scripts/plugin-entry.mjs`, the index repository's algorithm line for line, so the hash an index entry names is the one a machine computes over the package it fetched. The build and the plugin store lay entries out with this one module.
- The store's key changes once: it was the hash of node-tar's output and is now the hash of this archiver's. An entry stored under the old key stays readable, and a shipped package is stored again under its new key at the next boot.

## The builtin index

- The index the server used to embed by hand (`builtin-index.json`) is gone. `scripts/build-plugins.mjs` lays every package it ships out as a store entry (`<name>/<version>/<hash16>/manifest.toml + package-lock.json + package/`) and rebuilds `index.json` from that tree into the shipped prefix, so the index travels with the build: in a push's `plugins/`, in the desktop build and in a release install.
- An entry's metadata is its package.json's. The code plugins in `plugins/` now declare `author` and a top-level `categories`, which the catalogue groups by.
- A server run from source ships no prefix and lists no builtin entries.

## Downloads and pins

- Installing a package that is not on this machine takes the catalogue row the ask resolves to — the pinned content, or the highest version the range admits — fetches that exact version and compares its integrity before it enters the store. A mismatch returns `400 plugin_integrity_mismatch` with both values, and the staging directory is discarded. A name no source lists, or one listed only without an integrity, returns `400 plugin_not_installable`.
- A Project's `[plugins]` table accepts `name = { version = "…", integrity = "…" }`. Activation takes the pinned entry and no other; a malformed pin drops its entry. For a version range, activation now takes the highest stored version that satisfies it, and within one version the content the running build ships.
- `POST …/plugins/installed` accepts `integrity` and writes the pin.

## The catalogue

- `GET /api/plugins/registry` merges the build's index, this machine's plugin store and the published index into one table. Each row is one content with `sources` (`builtin`, `store`, `index`) and `installable`. A row without an integrity is listed and cannot be installed, and a yanked entry is left out.
- The Plugins page tags rows that are already on this machine or published, and a row that cannot be installed here says why and disables Install.
