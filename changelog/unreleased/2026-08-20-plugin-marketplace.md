# Plugin marketplace: registries, a shared index format, and the Plugins page

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `server`, `web`, `docs`

[中文版](2026-08-20-plugin-marketplace.zh.md)

Added plugin discovery to the harness: a registry abstraction on the server, a shared plugin index format, and a Plugins page in the Web App listing the four sandbox backend packages.

## Details

- Introduced the **plugin registry** concept: a registry is one source of plugin index entries. Two implementations shipped — a **builtin registry** serving an index embedded in the server package, and an **HTTP registry** fetching an `index.json` URL. Both run their document through the same validator, so a remote index is trusted no further than the embedded one.
- All registries share one **plugin index format**, modeled on typst/packages' `index.json` schema: a flat array of per-version entries with `name`, `version`, `description`, `authors`, `license`, and optional `repository` / `homepage` / `keywords` / `categories` / `updatedAt`. An entry's `name` is the package specifier an operator writes into `plugins.json`.
- Added `GET /api/plugins` (any logged-in user), serving the merged index of the configured registries. The registry list was fixed to the builtin one, which lists the four sandbox backends: bubblewrap (Linux), Seatbelt (macOS), MXC (Windows), and the DSH adaptor.
- Added the **Plugins** page to the Web App, in the navigation group after Models: a read-only card grid showing each entry's specifier, version, description, license, and keyword chips. Discovery only — installing a plugin stays the operator-side `plugins.json` edit.
