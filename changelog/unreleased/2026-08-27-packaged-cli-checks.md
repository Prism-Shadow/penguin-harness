# The bundled `penguin` command is checked in CI

- **Date:** 2026-08-27
- **Type:** process
- **Scope:** `desktop`, `ci`

[中文版](2026-08-27-packaged-cli-checks.zh.md)

The desktop app ships the CLI inside itself — `<app>/bin/penguin` and `<app>/bin/penguin.cmd`
run `<app>/dist/penguin.js` on the app's own Electron runtime, and every route that puts
`penguin` on PATH (the deb postinst, the macOS symlink, the Windows PATH entry, the AppImage
wrapper) points at one of those two launchers. Nothing verified that they were still in the
packed tree, so this batch added the checks.

## Details

- `packages/desktop/scripts/verify-packed-cli.mjs` inspects the tree `electron-builder --dir`
  produces: every packed app directory must carry both launchers and the bundled CLI entry, the
  POSIX launcher must be executable, and at least one of them must actually run and report the
  app's version. CI's `runtime` job invokes it on Linux, macOS and Windows, on the tree it
  already builds.
- `packages/desktop/test/launcher.test.ts` gained a `packaged CLI` block pinning the couplings
  those launchers depend on and nothing else compares: `bin/**/*` staying in electron-builder's
  `files`, `asar` staying off, `productName` and `linux.executableName` matching the executable
  names the launcher scripts exec, the tsup entry name matching `CLI_ENTRY_RELPATH`, and the deb
  templates still creating `/usr/bin/penguin` (never over a non-symlink) and removing only their
  own link.
