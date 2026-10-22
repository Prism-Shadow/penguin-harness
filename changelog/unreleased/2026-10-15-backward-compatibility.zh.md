# 数据兼容

- **Date:** 2026-10-15
- **Type:** refactor
- **Scope:** `server`, `core`
- **PR:** [#1167](https://github.com/Prism-Shadow/penguin-harness/pull/1167)
- **Breaking:** yes — Penguin Go 的 MMSP 之前路由只由服务端迁移，只经 SDK 读取时保持原样

[English](2026-10-15-backward-compatibility.md)

## Penguin Go 的 MMSP 之前路由

对 MMSP 切换之前存下的 Penguin Go 路由（`token.penguin.ooo/api` 上的 `google-genai` / `deepseek-official`）的一次性迁移，现在只在服务端的读取路径中进行，以及应用启动时对每个 Project 的一遍读取，它在任何其他读取之前把迁移后的文件写回。core 的 `loadProjectConfig` 不再迁移。只经 CLI 或 SDK 读取的文件保留旧路由，直到服务端读取它。兼容的旧形态与生效范围都与 [0.2.15 的记录](../0.2.15/2026-10-12-backward-compatibility.zh.md)相同；用户操作收窄为：经服务端或桌面应用打开文件时无需处理。

### 保留期限

在 0.3.0 发布准备时，由负责发布准备的人与 core 的 `migrateProjectConfigTable` 一并移除：`ProjectConfigService.readTable` 中不带 `endpoint` 的调用、`migratePenguinGoRoutes` 中 `endpoint === undefined` 的分支、`isPenguinGoEndpoint` 里 MMSP 之前的 origin 与路径、启动时的全量读取（`ProjectConfigStore.migrateStoredConfigs` 及其在 `Startup.setup` 中的调用，它只为这些一次性迁移而存在），以及服务端 `penguin-go-mmsp.test.ts` 中的迁移场景。带 `endpoint` 的路径保留。
