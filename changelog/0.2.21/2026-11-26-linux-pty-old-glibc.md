# Terminals open on Linux machines whose glibc is older than 2.42

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `release`, `desktop`, `ci`, `server`
- **PR:** [#1911](https://github.com/Prism-Shadow/penguin-harness/pull/1911)
- **Issue:** [#1900](https://github.com/Prism-Shadow/penguin-harness/issues/1900)

[中文版](2026-11-26-linux-pty-old-glibc.zh.md)

In 0.2.19 and 0.2.20 the Linux tarballs shipped a node-pty terminal binding compiled on the
`ubuntu-latest` runner, which had become Ubuntu 26.04, so it needed GLIBC_2.42 (for `cfsetispeed`
and `cfsetospeed`); 0.2.4 through 0.2.18 had needed 2.34. The install image the desktop app pushes
to machines carried no Linux binding at all. Every terminal on a Linux machine with an older glibc
failed with `terminal_spawn_failed`. node-pty's Linux bindings are now built in a manylinux_2_28
container and need glibc 2.28, the same as the bundled Node, and the release fails rather than
ship one that needs more.

## Details

- `scripts/build-linux-pty.sh` builds the linux-x64 and linux-arm64 bindings from the lockfile's
  node-pty sources in `quay.io/pypa/manylinux_2_28_<machine>` (pinned to `2026.11.07-1`), once per
  workflow run, through the new reusable workflow `.github/workflows/linux-pty.yml`. The arm64
  binding, which had been built in `node:<version>-bookworm` and needed 2.34, is built there too.
- `scripts/stage-linux-pty.mjs` writes them into a node-pty install's `prebuilds/linux-x64` and
  `prebuilds/linux-arm64` and replaces a Linux `build/Release/pty.node` compiled at install. The
  release job stages the workspace and `lib/`, the npm job and CI's npm packaging the workspace,
  and the desktop build, on all three systems, the workspace before it builds. The tarballs'
  `lib/` and carried store, the npm package's carried store, the desktop app's own node-pty and
  the install image each desktop app pushes to machines carry both bindings.
- `scripts/check-native-glibc.mjs` reads the symbol versions every Linux `*.node` in a shipped
  tree binds — directories, tarballs and the archives inside them, install images — and fails
  when one needs glibc newer than 2.28, when a binding sits under the wrong `linux-<arch>`, or
  when an expected binding is missing. It runs on every payload tarball before the release
  publishes, on the npm package's carried store, on the desktop app's `dist/` and plugins, and
  in CI's npm packaging job.
- The machine check stopped warning that terminals need glibc 2.34: `TERMINAL_GLIBC` became 2.28.
