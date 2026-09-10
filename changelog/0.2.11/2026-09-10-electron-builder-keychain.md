# macOS installers sign again: electron-builder 26.16.1

- **Date:** 2026-09-10
- **Type:** fix
- **Scope:** `desktop`, `ci`
- **PR:** [#669](https://github.com/Prism-Shadow/penguin-harness/pull/669)

[中文版](2026-09-10-electron-builder-keychain.zh.md)

The desktop package now builds with electron-builder 26.16.1 (from 26.15.3). The earlier version
unlocked its temporary signing keychain with the certificate's import password instead of the
keychain's own, which macOS used to tolerate on an already-unlocked keychain; the GitHub runner
image published on 2026-09-08 no longer does, so every signed macOS build failed in
`security set-key-partition-list` with "The user name or passphrase you entered is not correct".
26.16.1 carries the upstream fix
([electron-builder #10066](https://github.com/electron-userland/electron-builder/issues/10066)).
Nothing about the installers themselves changes.
