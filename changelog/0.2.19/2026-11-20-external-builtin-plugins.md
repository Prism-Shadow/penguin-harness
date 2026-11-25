# External built-in plugins are staged from their locked tarballs

- **Date:** 2026-11-20
- **Type:** process
- **Scope:** `tooling`, `ci`
- **PR:** [#1671](https://github.com/Prism-Shadow/penguin-harness/pull/1671)

[中文版](2026-11-20-external-builtin-plugins.zh.md)

The build learned to ship a built-in plugin published from another repository (PRFC-0036, design [#503](https://github.com/Prism-Shadow/penguin-harness-design/pull/503)). A `@penguinharness/*` dependency of `packages/server` that is not a workspace package, pinned to one exact version, is staged in the built-in prefix from the tarball whose sha512 `pnpm-lock.yaml` records, so the hot push, the release bundles, the desktop app, the carried store and the Docker image carry it as built in. No such plugin is pinned yet.

## Details

- `scripts/build-plugins.mjs` takes each external package's locked tarball from `PENGUIN_PLUGIN_TARBALLS=<dir>`, then from npm (its cache first), then from the github channel of the version's entry in the plugin index, and fails the build when the tarball's sha512 is not the lock's. A package with a code entry is unpacked into the prefix and listed in its manifest; one without stays library-only; one declaring runtime dependencies fails the build. The integrity is part of the prefix's cache key.
- `scripts/library-payload.mjs` carries an external package in the pushed library from where pnpm installed it, with the `ifaces.json` it was published with, and fails on one that ships none.
- `scripts/check-external-plugins.mjs` reports pins that differ between `packages/server`, `packages/cli` and `packages/desktop`, a range in place of a version, and a lock that does not resolve the pin; with `--index` it also compares the lock's sha512 with the plugin index's entry, warning instead when the index cannot be read. CI's npm packaging job runs it with `--index`.
- The release's version stamp of `packages/server/src/plugin/builtin-index.json` touches only the entries of this repository's `plugins/` packages.
- `plugins/README.md` and the release notes of the development skill describe external built-in plugins and how a pin is raised.
