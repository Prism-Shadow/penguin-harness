# Plugin marketplace: registries, a shared index format, and the Plugins page

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `server`, `web`, `docs`
- **PR:** [#383](https://github.com/Prism-Shadow/penguin-harness/pull/383)

[中文版](2026-08-20-plugin-marketplace.zh.md)

Added plugin discovery to the harness: a registry abstraction on the server, a shared plugin index format, and a Plugins page in the Web App listing the four sandbox backend packages, each entry opening a detail page with its readme.

## Details

- Introduced the **plugin registry** concept: a registry is one source of plugin index entries. Two implementations shipped — a **builtin registry** serving an index embedded in the server package, and an **HTTP registry** fetching an `index.json` URL. Both run their document through the same validator, so a remote index is trusted no further than the embedded one.
- All registries share one **plugin index format**, modeled on typst/packages' `index.json` schema: a flat array of per-version entries with `name`, `version`, `description`, `authors`, `license`, and optional `repository` / `homepage` / `keywords` / `categories` / `updatedAt`. An entry's `name` is the package specifier an operator writes into `plugins.json`.
- Added `GET /api/plugins` (any logged-in user), serving the merged index of the configured registries. The registry list was fixed to the builtin one, which lists the four sandbox backends: bubblewrap (Linux), Seatbelt (macOS), MXC (Windows), and the DSH adaptor.
- Added the **Plugins** page to the Web App, in the navigation group after Models: a single-column list, because the string that identifies a plugin is its package specifier — long, scoped and monospace — and two columns truncated exactly what an operator came to read. Each row opens the entry. Discovery only — installing a plugin stays the operator-side `plugins.json` edit.
- **An entry's detail page** carries its metadata and a rendered readme, so choosing a sandbox backend does not mean reading its source. Readmes are fetched per entry through `GET /api/plugins/readme?name=…` rather than carried in the index: the listing is sent in full on every visit, while a readme is large and wanted only for the entry someone opened. The endpoint answers only for entries the deployment lists, so it cannot be used to probe what exists, and a registry that has no readme for an entry answers null rather than a guessed URL. The readmes are the backend packages' own `README.md` files, inlined into the builtin registry at build time, so the catalogue holds no second copy of the prose to drift from the first; a test pins every listed entry's name, version, description and license to what the package itself declares. The four document what they enforce — bubblewrap's mount ordering and its unprivileged-user-namespace requirement, Seatbelt's last-rule-wins SBPL and its path canonicalization, MXC's Windows-only mapping onto all three dimensions and its optional ~40MB peer SDK, and the DSH adaptor's platform chain and its `fs-write`-only vocabulary.
