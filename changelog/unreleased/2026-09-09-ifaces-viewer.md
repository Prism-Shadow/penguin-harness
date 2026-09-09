# The module tree opens in one click

- **Date:** 2026-09-09
- **Type:** process
- **Scope:** `landing`, `ci`
- **PR:** [#450](https://github.com/Prism-Shadow/penguin-harness/pull/450)

`penguin.ooo/ifaces/` is a static viewer for the interface page CI uploads as a workflow artifact: given `?owner=…&repo=…&run=…&artifact=…` it fetches the artifact's zip through the artifact proxy, unpacks it in the browser and shows the page in a frame, with `ifaces.json` still downloadable beside it. The `artifact` parameter may be left off — the run's `ifaces-page-*` artifact is found by listing. When the fetch fails (the proxy refuses, or the artifact expired after 14 days) a zip downloaded by hand opens through the file picker. The `ifaces-page` job summary now links there, with the zip link beside it.
