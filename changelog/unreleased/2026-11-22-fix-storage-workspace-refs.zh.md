# 存储清理不再误删经链接引用的工作区

- **Date:** 2026-11-22
- **Type:** fix
- **Scope:** `plugins`, `server`

[English](2026-11-22-fix-storage-workspace-refs.md)

设置 › 存储不再把仍有 Session 在用的临时工作区列为可清理：Session 记录的路径经过符号链接或 Windows 目录联接（例如保留到 1.0 的 `<数据根>/<项目>` 链接）指向它时，也算在用。在 Windows 上，只有大小写不同的路径同样算在用。清理时这类工作区会按「在用」跳过，和路径原样写时一样。
