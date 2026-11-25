# 首次存储测量中断后自动重试

- **Date:** 2026-11-24
- **Type:** fix
- **Scope:** `storage`, `web`
- **PR:** [#1803](https://github.com/Prism-Shadow/penguin-harness/pull/1803)

[English](2026-11-24-storage-interrupted-first-read.md)

打开「设置 → 存储空间」时，如果首次测量结束却未返回数值或错误，页面会自动再测一次，完成后立即显示用量。如果仍未返回数值，可点「重试」重新测量。
