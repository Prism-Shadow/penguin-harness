# Plugins import from npm, a link or a zip, and export as a zip

- **Date:** 2026-10-09
- **Type:** feature
- **Scope:** `web`, `server`, `core`, `cli`
- **PR:** [#1012](https://github.com/Prism-Shadow/penguin-harness/pull/1012)

[中文版](2026-10-09-plugin-import-export.zh.md)

An admin installs plugins on the server from the Plugins page — by npm name or link, through an agent, or from a zip — and anyone exports a plugin's package as a zip that another server imports as it is.

## Import

- The Plugins page header has **Import plugin**, for admins only. The dialog says a plugin goes on the whole server and is shared by every Project, then offers three ways: install an npm package name or an https link to a git repository or a tarball directly; let the Project's default agent review a package found from a page, a repository or a description and install it with `penguin plugin install`; or upload a zip of a plugin's package directory. Another version on the server asks before it is replaced.
- What the server installs is checked before npm runs: a registry name, optionally with a version, range or tag, or an https link without credentials. Paths, `file:`, `http:` and ssh links, and `npm:` or `file:` aliases behind a name are refused.
- A zip is refused before anything is installed when a path leaves the package, it carries `node_modules/`, `package.json` is not at its root or in its one top-level directory, the package name or version is not valid, or the package is not a plugin the library would read as it is; the caps (2,000 files, 5 MB each, 50 MB in all, a 14 MB zip) are read before anything inflates. The server packs the files with `npm pack --ignore-scripts` and installs the tarball, which it keeps in the prefix's `archives/`.
- A package of Skills or hooks joins the plugin library, tagged **installed on server**, and is installed on agents like any other; it is never preinstalled on a new Project's default agent. A package of server modules is also listed for the Project and loaded; one from a link or a zip is listed for this server only, so another machine never fetches a different package under its name.

## Export and delete

- A plugin's details have **Export**, which downloads its package directory as `<name>-v<version>.zip` without `node_modules/`, for any member whenever the package is on the server.
- An admin deletes a plugin of Skills or hooks installed on the server from its details. The copies of its Skills and hooks installed on agents stay.

## CLI

- `penguin plugin install <specifier>`, `penguin plugin remove <name>` and `penguin plugin list` install, remove and list the plugins on the server with the local API token, the admin's.

## API

- `POST /api/projects/:projectId/plugins/installed` takes an https link besides a package name, and answers with `installed: {name, version, library, modules, unchanged?}`. A package of Skills or hooks alone is no longer written to the Project's `[plugins]` table.
- New: `POST /api/projects/:projectId/plugins/installed/archive` (admin; `{dataBase64, overwrite?}`; 409 `plugin_exists`), `GET /api/plugins/:plugin/archive` and `GET /api/plugins/registry/archive?name=` (any signed-in user).
- `PluginItem` gained `package`, and `source` reads `installed` for a plugin an admin installed. The registry listing has a row for each package of server modules installed from a link or a zip.
