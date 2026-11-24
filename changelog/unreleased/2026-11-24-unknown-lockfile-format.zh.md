# 未知格式的锁文件变更触发完整 CI

- **Date:** 2026-11-24
- **Type:** fix
- **Scope:** `ci`
- **PR:** [#1830](https://github.com/Prism-Shadow/penguin-harness/pull/1830)

[English](2026-11-24-unknown-lockfile-format.md)

当变更的锁文件使用不受支持的格式版本时，CI 会运行整个工作区的检查。

## 细节

版本 9.0 的锁文件变更仍只选择受影响的包。
