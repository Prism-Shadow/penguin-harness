# `penguin` 软链修复不再依赖 `rmSync` 删除软链

- **Date:** 2026-10-18
- **Type:** fix
- **Scope:** `desktop`
- **PR:** [#1201](https://github.com/Prism-Shadow/penguin-harness/pull/1201)

[English](2026-10-18-desktop-symlink-unlink.md)

`writeSymlink`（macOS 上自动安装 `penguin` 命令的磁盘侧）改用 `fs.unlinkSync` 而不是 `fs.rmSync` 移除链接路径上已有的软链。在 Node 24.0.0–24.13.0 上（nodejs/node [#61020](https://github.com/nodejs/node/issues/61020)，24.13.1 修复），`rmSync` 会静默留下悬空软链（不抛错），并对指向目录的软链抛出 `ERR_FS_EISDIR`——于是最需要修复的那种链接（从 dmg 启动、或应用被移动后留下的悬空链）无法替换，紧接着的 `symlinkSync` 便以 `EEXIST` 失败。这是对开发与测试路径的加固：发布版运行在 Electron 43.2.0 自带的 Node（24.18.0）上，已包含上游修复，因此没有任何已安装的应用受影响；desktop 测试套件运行在开发者自己的 Node 上，在这些版本上也以同样的方式失败。

## 细节

- `unlinkSync` 在所有 Node 版本上都只删除链接本身，绝不跟随它，因此链接所指向的目录会保留其内容。
  其它条目仍走 `rmSync`，所以目标路径上是一个真实目录时仍会以 `ERR_FS_EISDIR` 拒绝并保持不动。
- macOS 的自动安装与菜单项的强制安装都走这条修复后的路径。强制安装可以替换文件，但绝不删除目录。
