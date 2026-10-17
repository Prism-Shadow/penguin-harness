# 数据兼容

- **Date:** 2026-10-15
- **Type:** refactor
- **Scope:** `server`, `core`
- **PR:** [#1167](https://github.com/Prism-Shadow/penguin-harness/pull/1167)
- **Breaking:** yes — Penguin Go 的 MMSP 之前路由只由服务端迁移，只经 SDK 读取时保持原样

[English](2026-10-15-backward-compatibility.md)

## Penguin Go 的 MMSP 之前路由

对 MMSP 切换之前存下的 Penguin Go 路由（`token.penguin.ooo/api` 上的 `google-genai` / `deepseek-official`）的一次性迁移，现在只在服务端的读取路径（包括启动时的全量读取）中进行，core 的 `loadProjectConfig` 不再迁移。只经 SDK 读取的文件保留旧路由，直到服务端读取它。兼容的旧形态、生效范围与用户操作都与 [0.2.15 的记录](../0.2.15/2026-10-12-backward-compatibility.zh.md)相同：经服务端、桌面应用或 CLI 打开文件时无需处理。

### 保留期限

在 0.3.0 发布准备时，由负责发布准备的人与 core 的 `migrateProjectConfigTable` 一并移除 `ProjectConfigService.readTable` 中不带 `endpoint` 的调用、`migratePenguinGoRoutes` 中 `endpoint === undefined` 的分支，以及 `isPenguinGoEndpoint` 里 MMSP 之前的 origin 与路径。带 `endpoint` 的路径保留。
