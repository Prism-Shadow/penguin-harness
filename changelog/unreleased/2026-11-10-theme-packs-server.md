# Theme packs import and export: the server store, the validator and the routes

- **Date:** 2026-11-10
- **Type:** feature
- **Scope:** `server`, `theme-pack`, `ui`, `web`, `ui-gallery`
- **PR:** [#1529](https://github.com/Prism-Shadow/penguin-harness/pull/1529)

[中文版](2026-11-10-theme-packs-server.zh.md)

An admin can import a theme pack as a zip, and every account on that server can then pick it. Any pack, built-in or imported, exports to the same zip. Export Frost, rename it, change a few values and import it: that is how a new pack starts.

## The validator

- `packages/theme-pack` (`@prismshadow/penguin-theme-pack`, private) holds:
  - the manifest schema, which is closed: an unknown field is refused;
  - the CSS grammar a pack may write, as positive lists;
  - the font and drawing checks;
  - the zip reader and writer;
  - the built-in packs' export form.
- The server runs it at import. The UI package's suite runs the same validator over every built-in pack in its export form.
- Each stylesheet is parsed with css-tree and stored as the parser re-emits it, never as uploaded. Text the parser could not read, a node type the checks do not name, and a function, pseudo-class, attribute or at-rule outside the lists are each a refusal with the file, line, column and reason. Two examples are a prefix test of an input's value and a `url()` leaving the pack.
- The grammar is PRFC-0026's, with four additions the built-in packs are written with:
  - `*`;
  - `:lang()` with language tags;
  - `^=` on `role` alone;
  - `@keyframes` named `ui-…` beside `<id>-…`.
- An import is also held to the clean baseline's static rules (R1, R2, R5–R11) with no hit allowed, and a hit refuses it with the rule and what it found. The rules come from the UI package's own table, the one its de-slop suite runs over the built-in packs, so the two cannot drift. The server takes it through a new subpath, `@prismshadow/penguin-ui/pack-rules`. The one regex it read from the de-slop module moved to a module of its own, so the table carries no other code.
- Fonts are WOFF2 only, with the header and table directory read. Drawings take a plugin icon's check.
- Caps: 200 files, a 16 MiB zip, 24 MiB unpacked, 512 KiB of stylesheets, 12 MiB of fonts, 2 s of parsing.

## The store and the routes

- Packs live under the data root at `themes/<id>/`. Each holds:
  - the normalised `pack.json`;
  - the re-emitted stylesheets;
  - the assembled `index.css`, with the stylesheets in `ui-theme` and `ui-accent` and every pack `url()` rewritten to `/api/themes/<id>/files/<path>?v=<v>`. It holds nothing of the build that serves it. It is served with the app stylesheet's whole layer order in front (Tailwind's layers, then the theme's four), read once per build from the stylesheets `index.html` links. After a reload the pre-paint script links a picked pack before the app's sheet, and the statement keeps the layer order the same either way. The `v` a pack is listed and served at mixes that order into the content digest, so a build that changes the order moves every pack's address;
  - the fonts and drawings;
  - `installed.json`, whose `files` list is the only thing ever served.
- Each upload is kept at `themes/archives/<id>-<version>-<sha8>.zip`.
- `v` is a digest of the pack's content, so an export imported again lands byte for byte.
- `GET /api/themes`, `GET /api/themes/:id/files/<path>`, `POST /api/themes[?replace=1]` (admin, the raw zip), `DELETE /api/themes/:id` (admin) and `GET /api/themes/:id/export` are documented on the server API page.
- Every write sends `themes_changed` to every signed-in user's event stream.
- The UI package's Vite plugin writes each built-in pack's sources into the build at `themes/<id>/`, with a `fonts.json` mapping the pack's own fonts to the hashed assets the bundle already carries. A server exports a built-in from the very build it serves, offline. Frost's rules are scoped to its id on export, and a pack whose faces are the app's shared ones exports without `fonts.css`. Frost exports without its `recipes.css`, with a README saying a `base: "modern"` pack takes them from the base, so an exported Frost imports once its id alone is renamed.

## The Web App contract

- The API types gain `ThemePackDto`, `ThemePacksResponse`, `ThemePackImportResponse`, the theme-pack error codes and `ThemeInvalidDetails`.
- The Web App gains five wrappers: `listThemePacks`, `importThemePack`, `deleteThemePack`, `themePackExportUrl` and `themePackFileUrl`.
- The gallery's mock server answers them with one fixture pack.
