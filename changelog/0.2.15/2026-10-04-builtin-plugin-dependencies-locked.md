# Builtin plugin dependencies install at their locked versions

- **Date:** 2026-10-04
- **Type:** feature
- **Scope:** `build`, `plugins`
- **PR:** [#979](https://github.com/Prism-Shadow/penguin-harness/pull/979)

[中文版](2026-10-04-builtin-plugin-dependencies-locked.zh.md)

The third-party packages `scripts/build-plugins.mjs` installs into the builtin plugin prefix are now the versions `pnpm-lock.yaml` resolves, and their licenses ship with them.

- The build reads the closure of the plugins' native dependencies from `pnpm-lock.yaml`, including the per-platform packages for every target, and writes it into the prefix's manifest as npm `overrides`, so npm installs those exact versions for transitive packages too (23 packages for the DSH chain and koffi, for example `@deepseek-ai/cordis` 4.0.1 where npm had resolved 4.0.4). The per-platform packages the second install adds come from the same closure.
- After installing, the build fails if npm's tree holds a package or version the lockfile does not name, misses one it does, or holds a tarball whose integrity differs from the lockfile's `resolution.integrity`. The lockfile entries are part of the build's cache key.
- The build writes `THIRD-PARTY-NOTICES.md` at the prefix's root, so it ships wherever the prefix does: one section per third-party package with its license id, repository, homepage and full license text. koffi's platform packages ship no license file, so their sections carry koffi's text and say so; any other package without license text fails the build.
