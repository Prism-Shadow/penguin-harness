# Windows 安装器迁移数据时正确处理隐藏文件

- **Date:** 2026-11-23
- **Type:** fix
- **Scope:** `desktop`
- **PR:** [#1789](https://github.com/Prism-Shadow/penguin-harness/pull/1789)

[English](2026-11-23-windows-setup-hidden-files.md)

在 Windows 安装器中将服务数据或桌面配置迁移到其他目录时，现可正常校验并复制隐藏文件（包括 `desktop.ini` 等隐藏系统文件与隐藏配置文件），不再因找不到文件而中止安装。

## 细节

- 在首次迁移与再次迁移数据时，完整保留隐藏文件的内容、Windows 隐藏/系统/只读属性以及命名数据流。
