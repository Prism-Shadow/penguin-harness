# Windows 程序安装目录

- **Date:** 2026-11-23
- **Type:** fix
- **Scope:** `desktop`

[English](2026-11-23-windows-program-directory.md)

Windows 桌面安装向导在浏览选择文件夹时显示最终程序路径。选择磁盘或父目录后，程序将安装到其中的 `penguinharness` 子目录。更新沿用原有程序目录。卸载时仅清理安装的程序文件，保留其他文件。

旧版自定义程序目录的处理见[存量安装兼容性](2026-11-23-backward-compatibility.zh.md)。
