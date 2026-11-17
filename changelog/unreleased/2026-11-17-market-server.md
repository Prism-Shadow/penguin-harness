# The server reads the plugin market's curation and serves its pictures

- **Date:** 2026-11-17
- **Type:** feature
- **Scope:** `server`, `core`, `landing`, `docs`
- **PR:** [#1580](https://github.com/Prism-Shadow/penguin-harness/pull/1580)

[中文版](2026-11-17-market-server.zh.md)

The plugin market's curation lives in one document, the community repository's
`assets/plugins/market.json` (schema 1): which plugins the maintainers selected, which of them
may lead the market's carousel, and the cover, raster icon and screenshots of the plugins that
have any, keyed by npm package name, each picture a path beside the document. The server now
reads it and hands it to the Web App:

- `GET /api/plugins/market` (any signed-in user) answers `{hero, selected, art, source}`. `art`
  gives a plugin's `cover` (`url`, `thumbUrl`, `tone`), `icon` and `screenshots` (with their
  captions in both languages), every URL one of this server's own routes. The document carries
  no count, rank or rating.
- Two sources, like the plugin index: a copy built into the server
  (`packages/server/src/plugin/builtin-market.json`, refreshed from the community repository at
  each release) and the published document, fetched through the deployment's mirror rules
  (`PENGUIN_PLUGIN_PROXY`), reused for 30 minutes, served stale while a refresh runs and kept
  across a hot push. Once the published document has answered it replaces the built-in one; the
  listing waits at most 1.5 s for the first fetch. `source` says which answered (`embedded` or
  `published`). A document that breaks a rule of schema 1, or names another schema, is not used:
  the built-in copy stands. `PENGUIN_PLUGIN_MARKET=off` reads the built-in copy alone with no
  outbound request; any other value replaces the document's URL.
- `GET /api/plugins/market/asset?path=…&rev=…` serves one picture the current document names, and
  answers anything else with 404 without fetching. The server fetches the picture from beside the
  document through the same mirror rules (15 s per address, at most 2 MB, at most four fetches at
  once, one per picture in flight), serves it only when its bytes are WebP, PNG or JPEG, and keeps
  it under `<data root>/.cache/plugin-market/`, revalidating it by ETag after a day and serving it
  from there while the source is down. A picture it cannot get is 404, which the page answers with
  the cover it draws itself.
- An App Center shortcut names the library plugin that installed its workbench (`plugin`, from
  the folder's `.plugin.json` receipt); a workbench written by hand names none.
- The plugin library gains the category `learning-life` (Learning & Life / 学习与生活), listed
  before the sandbox backends, and the landing site's plugin list orders and colours it.

## Data root

`<data root>/.cache/plugin-market/` is new and holds fetched pictures only, one pair of files per
picture. Its dot-prefixed name is one no Project id can take, so it claims no Project name and
never lands inside a Project's directory. It is a cache: nothing exports or backs it up, and
deleting it costs a fetch per picture.
