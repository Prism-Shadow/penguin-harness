# Resume an interrupted first storage measurement

- **Date:** 2026-11-24
- **Type:** fix
- **Scope:** `storage`, `web`
- **PR:** https://github.com/Prism-Shadow/penguin-harness/pull/1803

[中文版](2026-11-24-storage-interrupted-first-read.zh.md)

Opening Settings → Storage now restarts the first measurement once if it ended without figures or an error. The page shows the measured usage as soon as it arrives. If the retry yields no figures, the Retry button remains available.
