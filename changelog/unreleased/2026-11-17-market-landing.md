# The site's Plugins pages become the plugin market

- **Date:** 2026-11-17
- **Type:** feature
- **Scope:** `landing`
- **PR:** [#1583](https://github.com/Prism-Shadow/penguin-harness/pull/1583)

[中文版](2026-11-17-market-landing.zh.md)

The featured plugin stays above search and filters, including in a shared category link. Use the arrows to browse one featured plugin at a time. The directory offers cover cards and a compact list, one row per plugin, through two icons beside the sort (a grid and a list, each named on hover), and remembers the chosen view.

Search, filter by category, sort by name, update date or selection, and open the same product page from either view. Bundled plugin covers ship with the site. Other images come from the community repository.

The website and the App read the same official plugin directory and pick the same release for each package. The site's build reads it with the server's own readers, through core's `@prismshadow/penguin-core/plugin-index` ([plugin-index-core](2026-11-19-plugin-index-core.md)). External workbenches with a pinned GitHub archive now have a download link on their detail page. A failed refresh keeps the last valid catalog available.
