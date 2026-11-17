# 四舍五入到 1024 kB 的图片大小显示为 1.0 MB

- **Date:** 2026-11-05
- **Type:** fix
- **Scope:** `core`
- **PR:** [#1493](https://github.com/Prism-Shadow/penguin-harness/pull/1493)

[English](2026-11-05-image-size-carry.md)

`read_file` 不再把略小于 1 MB 的图片报成 `1024.0 kB`。`formatSize` 原先按原始大小选 kB，再保留一位小数，所以 1,048,570 字节显示为 `image/png, 1024.0 kB`。现在显示为 `1.0 MB`。单位改为按四舍五入后的数值选择，和 Web App 的 `formatBytes` 规则一致。
