# 数据根布局迁移的 Project 目录要么全部移入，要么都不动

- **Date:** 2026-11-25
- **Type:** fix
- **Scope:** `core`, `server`
- **PR:** [#1865](https://github.com/Prism-Shadow/penguin-harness/pull/1865)

[English](2026-11-25-layout-migration-windows-rename.md)

数据根的布局迁移（[Project 移入 `projects/`](2026-11-20-data-root-projects.zh.md)）改为一次运行要么移入全部 Project 目录，要么一个都不动。某个 Project 目录改不了名时（比如在 Windows 上它正被某个程序打开），数据根保持原来的布局，遇到它的启动或热更新会说明该关掉什么。

## 细节

- 迁移先把本次的每个 Project 目录改名移入 `projects/` 并在原处留好链接，再改写各 Project 记录的路径。某个目录改不了名时，此前已移入的按相反顺序移回原处，本次的日志条目和空的 `projects/` 目录一并删除，迁移停下，什么都没有移动。下次启动或推送时全部重试。
- Windows 重试之后仍拒绝的改名（`EPERM`、`EBUSY` 或 `EACCES`）以新的 `LayoutMigrationError` 代码 `folder_in_use` 停止。说明里写出该目录，以及通常占着它的程序：终端、编辑器、文件资源管理器窗口，或在它某个 Workspace 里运行的命令。
- 推送的平台遇到这种拒绝时，会在说明后补上两点：服务端保持当前版本；重启服务端会结束它的终端和命令，而热更新会让它们继续运行。
