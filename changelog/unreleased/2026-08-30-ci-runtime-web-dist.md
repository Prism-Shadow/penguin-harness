# The unpacked runtime artifact carries the Web App, and packing without it fails

- **Date:** 2026-08-30
- **Type:** fix
- **Scope:** `ci`, `desktop`, `tooling`

[中文版](2026-08-30-ci-runtime-web-dist.zh.md)

CI's `penguin-runtime-*` artifact — the unpacked desktop tree built for hot-update use — shipped without `web-dist` since the job was introduced: its build filter named the desktop package and its dependencies, the web package is not one of them (the app carries the web build by an electron-builder file mapping, not an import), and electron-builder skips an absent `from:` source in silence. A machine running that tree answered 404 on every page unless its data root held a hot-pushed web version to restore. GitHub Release installers build the whole workspace first and were never affected.

## Details

- The `runtime` job builds `@prismshadow/penguin-web` alongside the desktop package.
- The desktop `pack*` scripts, the `runtime` job and the release matrix run `scripts/preflight.mjs` before electron-builder, so packing without a web build fails with the fix named.
- `verify-packed-cli.mjs`, CI's check of the packed tree, also requires `web-dist/index.html`.
