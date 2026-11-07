# An image size that rounds up to 1024 kB reads as 1.0 MB

- **Date:** 2026-11-05
- **Type:** fix
- **Scope:** `core`
- **PR:** [#1493](https://github.com/Prism-Shadow/penguin-harness/pull/1493)

[中文版](2026-11-05-image-size-carry.zh.md)

`read_file` no longer reports an image just under a megabyte as `1024.0 kB`. `formatSize` picked kB from the raw size and then rounded to one decimal, so 1,048,570 bytes read `image/png, 1024.0 kB`. It now reads `1.0 MB`. The unit is chosen from the rounded figure, the rule the Web App's `formatBytes` already follows.
