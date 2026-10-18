# `penguin` 软链在任意 Node 24 补丁版本上都能被修复

- **Date:** 2026-10-18
- **Type:** fix
- **Scope:** `desktop`

[English](2026-10-18-desktop-symlink-repack.md)

`writeSymlink` 改用 `fs.unlinkSync` 而不是 `fs.rmSync` 来移除链接路径上的软链。在 Node 24.0.0–24.13.0
上，`rmSync` 会静默留下悬空软链（不抛错），并对指向目录的软链抛出 `ERR_FS_EISDIR`——于是最需要修复
的那种链接（从 dmg 启动、或应用被移动后留下的悬空链）无法重建，紧接着的 `symlinkSync` 便以 `EEXIST`
失败。

## 细节

- `unlinkSync` 在所有 Node 版本上都只删除链接本身，绝不跟随它，因此链接所指向的目录会保留其内容。
  其它条目仍走 `rmSync`，所以目标路径上是一个真实目录时仍会以 `ERR_FS_EISDIR` 拒绝并保持不动。
- macOS 的自动安装与菜单项的强制安装都走这条修复后的路径。强制安装可以替换文件，但绝不删除目录。
