# The site's Plugins pages become the plugin market

- **Date:** 2026-11-17
- **Type:** feature
- **Scope:** `landing`

[中文版](2026-11-17-market-landing.zh.md)

The public site's `/plugins` and `/plugins/:id` were rebuilt from the shared showcase modules: the list opens with the selected carousel over a grid of cover cards, and each plugin's page is laid out as a product page. The build reads the plugin market's curation document and the published plugin index, so plugins this repository does not bundle are listed too.

## Data

- The build fetches the market document (the community repository's `assets/plugins/market.json`) and the published plugin index once each and keeps the copies in the package's cache, so the pages, the route shells and the sitemap read the same documents. When a fetch fails or answers a document that breaks the schema-1 rules, the build warns and uses the market document embedded beside the server, or lists the bundled plugins alone. `PENGUIN_MARKET_DOC` and `PENGUIN_PLUGIN_INDEX_DOC` name local files instead; a local file that breaks the rules fails the build.
- A plugin's record gained its authored cover, its screenshots, whether it is selected, its full description in the list, and its update day: the newest dated version among its Skills, hook package and workbenches, or an index row's `updatedAt`.
- Every index row whose package is not under `plugins/` lists once, at its newest version, with its row's words, category, author, licence and repository, its contents from the `skills`, `hooks` and `workbenches` keywords, and the market document's cover, screenshots and raster icon. Its page id is the bare name for a `@penguinharness/` package and `<scope>__<name>` for another scope. A repository or author link that is not an http(s) URL is dropped.
- The pictures load in the reader's browser from the community repository (`pluginAssetUrl`).

## Pages

- `/plugins`: while no search or facet is active, the selected carousel heads the list; its leading slide turns daily among the document's `hero` plugins. Every plugin is a cover card, its generated cover drawn in the plugin's own hue, with "Selected" and its category as tags. The orders are Selected first (the default), Recently updated and Name.
- `/plugins/:id`: a product hero with the cover, the icon, the name, the package, the one line, tags, "Get PenguinHarness" and "Source"; the screenshots, each linking to its picture; then About, Quick start with a copy button, What it installs, README and References beside the facts, which gained the update day and, for an RSI toolkit, the leaderboards that measured it. A plugin that is not bundled shows its hero, screenshots, description and facts, and its Source is its repository.
- `HubList` gained two optional props, `lead` (shown while nothing narrows the list) and `wrapList` (the caller's list layout). The Benchmarks and Leaderboards pages do not pass them and render as before.
