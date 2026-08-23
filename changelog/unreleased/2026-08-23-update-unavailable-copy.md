# The updates-unavailable copy names the AppImage rule instead of assuming dpkg

- **Date:** 2026-08-23
- **Type:** fix
- **Scope:** `desktop`, `web`

[中文版](2026-08-23-update-unavailable-copy.zh.md)

On Linux the shell can only replace an AppImage, so every other form — a `.deb` install,
but also an unpacked tree — lands in the same unsupported state. Both places that report it
said the copy came from a system package manager and to update it there, which is wrong
advice for anyone not running a `.deb`. The desktop dialog and the account-menu row now
state the rule and give both routes: the package manager for a package install, a manual
download otherwise.

## Details

- The web string was renamed `clientUnsupportedPackage` → `clientUnsupportedNonAppImage`
  in both dictionaries, so the key names the condition it renders for.
- `electron-builder.yml`'s `extraMetadata` comment no longer claims `name` decides the app
  data directory; the shell's own `app.setName()` runs before anything reads `userData`.
