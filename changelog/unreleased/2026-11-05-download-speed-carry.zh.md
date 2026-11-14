# 测速略低于 1 MB/s 的下载源显示为 1.0 MB/s

- **Date:** 2026-11-05
- **Type:** fix
- **Scope:** `landing`
- **PR:** [#1494](https://github.com/Prism-Shadow/penguin-harness/pull/1494)

[English](2026-11-05-download-speed-carry.md)

下载页的下载源按钮不再显示 `1024 KB/s`。`formatSpeed` 原先按原始速度选 KB/s，再取整到 KB，所以测得 1023.6 KB/s 的下载源显示为 `1024 KB/s`。现在显示为 `1.0 MB/s`。`formatSpeed` 改为从 `pages/download.tsx` 导出，以便测试调用。
