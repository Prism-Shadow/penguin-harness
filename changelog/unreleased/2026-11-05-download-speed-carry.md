# A download source tested at just under 1 MB/s reads 1.0 MB/s

- **Date:** 2026-11-05
- **Type:** fix
- **Scope:** `landing`
- **PR:** [#1494](https://github.com/Prism-Shadow/penguin-harness/pull/1494)

[中文版](2026-11-05-download-speed-carry.zh.md)

The download page's source buttons no longer show `1024 KB/s`. `formatSpeed` picked KB/s from the raw speed and then rounded to whole kilobytes, so a source measured at 1023.6 KB/s read `1024 KB/s`. It now reads `1.0 MB/s`. `formatSpeed` is exported from `pages/download.tsx` so a test can reach it.
