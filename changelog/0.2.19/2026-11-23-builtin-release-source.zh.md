# 从锁定的 GitHub Release 分发内置插件

- **Date:** 2026-11-23
- **Type:** feature
- **Scope:** `build`
- **PR:** [#1748](https://github.com/Prism-Shadow/penguin-harness/pull/1748)

[English](2026-11-23-builtin-release-source.md)

宿主可直接锁定 GitHub Release 上的插件包。构建在分发前校验 SHA512、包名和包版本；离线构建可从本地归档目录读取同一附件。
