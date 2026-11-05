# A checkout loads plugins from the repo's plugins/ directory, and CI requires a version bump

- **Date:** 2026-09-14
- **Type:** fix
- **Scope:** `core`, `ci`
- **PR:** [#725](https://github.com/Prism-Shadow/penguin-harness/pull/725)

[中文版](2026-09-14-plugins-from-workspace.zh.md)

## What changed

- In a workspace checkout, core's plugin loader reads each plugin from the repo's `plugins/<name>/` directory instead of the copy pnpm injects under `node_modules`. That copy is a snapshot taken at install time and refreshed only after the package's `build` script runs — which plugins have none of — so a skill added or a `plugin.json` version bumped after the last install never reached a running `pnpm dev`, nor the server's own tests: the plugin library kept showing the old version and installed agents never saw an update to take. The redirect applies only under a `pnpm-workspace.yaml`; an npm install and the packed desktop app keep resolving their own copy.
- CI gains a `plugin versions` job: a pull request that changes files under `plugins/<name>/` must also change that plugin's `plugin.json` version (`YYYY.MM.DD.N`), because that version is what tells an installed copy it is behind the library. `scripts/check-plugin-versions.mjs` does the comparison against the base commit and passes when there is nothing to compare.
