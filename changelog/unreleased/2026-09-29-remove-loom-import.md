# Remove the Loom import

- **Date:** 2026-09-29
- **Type:** refactor
- **Scope:** `server`, `web`, `activities`

The "Import from Loom" dialog and its two routes (`GET .../activities/import-sources`, `POST .../activities/import`) are gone, along with the reader, mapping and apply steps behind them. Activities are moving into their own module folders in Loom's layout, so there will be nothing to copy in.
