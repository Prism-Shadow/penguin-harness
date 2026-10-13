# Machines: a macOS desktop app installs on other machines

- **Date:** 2026-10-13
- **Type:** fix
- **Scope:** `server`, `desktop`

[中文版](2026-10-13-desktop-install-image.zh.md)

The macOS desktop app refused every install from the Machines page with `409` `no_install_image` ("This server has no install image to push"). The server finds the release a packaged app stands on by its install path, `<resources>/app/dist/server.js`, and compared the resources directory's name exactly against `resources`; inside a macOS app bundle that directory is `Contents/Resources`, so every Mac's app read as standing on no release. The name is now compared without regard to case. A desktop app installs the way a tarball install does on every platform: the machine downloads the app's own release for its own system and architecture, and the app's pushed state, when it has one, is copied over.

## Details

- The desktop build copies the far-side installers from the same list the server package and the hot push use (`scripts/far-side-scripts.mjs`).
- `verify-packed-cli.mjs`, which CI runs on the packed app on all three platforms, also checks what a machine install reads off the app: `dist/server.js`, the installers beside it, and the version in the app's `package.json`.
