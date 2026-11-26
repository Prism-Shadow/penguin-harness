# Windows 数据迁移同步改写旧版顶层项目内的路径与记忆

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `core`, `server`

[English](2026-11-26-windows-relocate-legacy-projects.md)

修复了使用 Windows 安装程序将尚未迁移到 `projects/` 布局的旧版数据目录移至新位置后首次启动时遗漏改写路径的问题。顶层旧项目目录中的项目配置、组织配置、日程文件以及工作区记忆已在布局迁移将其移入 `projects/` 之前同步更新到新位置，不再被跳过而永久残留旧位置路径。

## 细节

- 在 Windows 数据迁移改写项目路径与重算工作区记忆键时，同时扫描 `projects/` 下与顶层的旧布局项目目录。
- 补充了回归测试，覆盖 `projects/` 与顶层旧项目在 Windows 迁移后再执行 `projects/` 布局迁移的完整流程。
