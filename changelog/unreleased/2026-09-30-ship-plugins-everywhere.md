# Every build that serves the Web App ships the builtin plugins

- **Date:** 2026-09-30
- **Type:** fix
- **Scope:** `cli`, `server`, `web`, `tooling`, `ci`

[中文版](2026-09-30-ship-plugins-everywhere.zh.md)

Installing a module plugin from the Web App failed everywhere except in the desktop app, with
"'@prismshadow/penguin-plugin-sandbox-wsl' does not ship with this build; only builtin plugins can
be installed." The server installs only what the builtin plugin prefix names
(`scripts/build-plugins.mjs`), and that prefix reached only the desktop installer and the hot
push. The npm package, the installer bundles, the Docker image and a source checkout carried none,
so no plugin was installable there.

## Details

- The CLI's build stages the prefix beside its `dist/` as `packages/cli/plugins/`, and the package
  lists `plugins` in `files`. The npm tarball carries it, and so do the installer bundles and the
  Docker image, whose `lib/` is the CLI package deployed (`lib/plugins/`). The prefix holds every
  target platform's native binaries, so the one a Linux release job builds serves Windows and
  macOS too.
- The server looks for the prefix one directory above the program's entry, and resolves symlinks
  in `process.argv[1]` first. An npm global install and the Docker image put `penguin` on PATH as a
  symlink to `dist/penguin.js`, and the unresolved link pointed the lookup at the directory above
  the bin directory.
- `pnpm dev`'s prestep (`scripts/dev-prebuild.mjs`) stages the prefix a second time as
  `packages/server/plugins/`, where the dev server finds it: `tsx` runs
  `packages/server/src/index.ts`. The prefix is cached by content, so after the first build this is
  a copy.
- On the Plugins page, an available row the running build does not ship has no **Install**: it is
  dimmed, reads "not in this build", and gives the reason on hover. The server's `400
  plugin_not_shipped` stays as the backstop.
- CI's npm packaging job fails when the CLI tarball lacks the prefix. `scripts/test-installer.sh`
  asserts that an installed bundle keeps `lib/plugins` beside `lib/dist`, through the
  pinned-directory upgrade as well, and that a builtin plugin resolves from the program's entry.
- Size: the `@prismshadow/penguin-cli` tarball grew from 0.80 MB to 4.19 MB (2.97 MB to 14.08 MB
  unpacked), each installer bundle by about 2.8 MB (`penguin-universal.tar.gz`: 42.8 MB to
  45.6 MB), and the Docker image by the prefix's 11.1 MB on disk.
