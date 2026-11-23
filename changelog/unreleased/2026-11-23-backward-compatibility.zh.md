# 已有 Windows 数据目录

- **Date:** 2026-11-23
- **Type:** feature
- **Scope:** desktop, core, cli, server
- **PR:** https://github.com/Prism-Shadow/penguin-harness/pull/1759

[English](2026-11-23-backward-compatibility.md)

升级沿用现有服务数据和 Electron 配置目录。主动改选目录时，安装器复制这两部分数据，校验文件后才记录当前 Windows 用户的新位置。取消或失败后仍使用原位置。迁移前请退出桌面应用并停止服务端。显式指定的根目录和环境变量仍按原有顺序生效。

安装和卸载均保留原件。用户确认新位置的数据和桌面配置可用后，可自行决定何时删除旧副本。已有安装仍可继续使用标准目录。

已有会话的 Workspace 位于原服务数据目录内时，会话恢复和文件操作使用新盘上对应的副本。原始 Trace 保留当时记录的路径，数据目录以外的 Workspace 继续使用原位置。应保留安装器写入新目录的路径记录，供仍引用旧位置的会话恢复。
